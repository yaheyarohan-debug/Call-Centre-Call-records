import * as XLSX from 'xlsx';
import { CallEvaluationRecord } from '../types/cqm';
import { formatDuration } from './audio';

const MAX_EXCEL_CELL_CHARS = 32700;

function sanitizeCell(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value.length > MAX_EXCEL_CELL_CHARS) {
    return `${value.slice(0, MAX_EXCEL_CELL_CHARS)}... [truncated]`;
  }
  return value;
}

function sanitizeRows(rows: Array<Array<string | number | null | undefined>>): Array<Array<string | number>> {
  return rows.map((row) => row.map((cell) => sanitizeCell(cell)));
}

export interface AgentPerformanceSummaryRow {
  agentId: string;
  agentName: string;
  callCount: number;
  avgScore: number;
  minScore: number;
  maxScore: number;
  excellentCount: number;
  goodCount: number;
  averageCount: number;
  poorCount: number;
  finalisedCount: number;
  criticalFindingsCount: number;
  weakestParameter: string;
  weakestParameterPct: number | null;
}

export function computeAgentPerformanceRows(
  records: CallEvaluationRecord[]
): AgentPerformanceSummaryRow[] {
  const evaluated = records.filter((r) => r.scorecard.length > 0);
  interface AgentAccumulator {
    agentId: string;
    agentName: string;
    scores: number[];
    excellentCount: number;
    goodCount: number;
    averageCount: number;
    poorCount: number;
    finalisedCount: number;
    criticalFindingsCount: number;
    paramTotals: Map<string, { name: string; awarded: number; max: number }>;
  }
  const byAgent = new Map<string, AgentAccumulator>();

  for (const rec of evaluated) {
    const rawId = (rec.metadata.agentId || '').trim();
    const rawName = (rec.metadata.agentName || 'Unknown Agent').trim();
    const key = (rawId || rawName).toLowerCase();

    const entry: AgentAccumulator = byAgent.get(key) || {
      agentId: rawId || 'N/A',
      agentName: rawName,
      scores: [],
      excellentCount: 0,
      goodCount: 0,
      averageCount: 0,
      poorCount: 0,
      finalisedCount: 0,
      criticalFindingsCount: 0,
      paramTotals: new Map(),
    };

    entry.scores.push(rec.overallScore);
    if (rec.performanceBand === 'Excellent') entry.excellentCount += 1;
    else if (rec.performanceBand === 'Good') entry.goodCount += 1;
    else if (rec.performanceBand === 'Average') entry.averageCount += 1;
    else entry.poorCount += 1;

    if (rec.reviewState === 'finalised') entry.finalisedCount += 1;
    entry.criticalFindingsCount += rec.criticalFindings.filter(
      (f) => f.status !== 'rejected'
    ).length;

    for (const p of rec.scorecard) {
      if (p.status === 'Not Assessable') continue;
      const eff = p.evaluatorMarks !== null ? p.evaluatorMarks : p.awardedMarks;
      const curr = entry.paramTotals.get(p.parameterId) || {
        name: p.parameterName,
        awarded: 0,
        max: 0,
      };
      curr.awarded += eff;
      curr.max += p.maxMarks;
      entry.paramTotals.set(p.parameterId, curr);
    }

    byAgent.set(key, entry);
  }

  return Array.from(byAgent.values())
    .map((entry) => {
      const count = entry.scores.length;
      const sum = entry.scores.reduce((s, v) => s + v, 0);
      const avgScore = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
      const minScore = count > 0 ? Math.min(...entry.scores) : 0;
      const maxScore = count > 0 ? Math.max(...entry.scores) : 0;

      let weakestParameter = 'N/A';
      let weakestPct: number | null = null;
      for (const p of entry.paramTotals.values()) {
        if (p.max <= 0) continue;
        const pct = Math.round((p.awarded / p.max) * 1000) / 10;
        if (weakestPct === null || pct < weakestPct) {
          weakestPct = pct;
          weakestParameter = p.name;
        }
      }

      return {
        agentId: entry.agentId,
        agentName: entry.agentName,
        callCount: count,
        avgScore,
        minScore,
        maxScore,
        excellentCount: entry.excellentCount,
        goodCount: entry.goodCount,
        averageCount: entry.averageCount,
        poorCount: entry.poorCount,
        finalisedCount: entry.finalisedCount,
        criticalFindingsCount: entry.criticalFindingsCount,
        weakestParameter,
        weakestParameterPct: weakestPct,
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore || b.callCount - a.callCount);
}

/**
 * Builds a single-call workbook with exact 4 sheets:
 * 1. Call Summary
 * 2. CQM Scorecard
 * 3. Feedback
 * 4. Transcription
 */
export function buildSingleEvaluationWorkbook(record: CallEvaluationRecord): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const hasScorecard = record.scorecard.length > 0;

  // Sheet 1: Call Summary
  const summaryRows = sanitizeRows([
    ['AI FNOL CALL QUALITY MONITORING REPORT', ''],
    ['Report Generated', new Date().toLocaleString()],
    [
      'Review Status',
      !hasScorecard
        ? 'Transcription Only (CQM Evaluation Pending)'
        : record.reviewState === 'finalised'
        ? 'Evaluator Finalised'
        : record.reviewState === 'evaluator_reviewed'
        ? 'Evaluator Reviewed'
        : 'AI Draft (Pending Review)',
    ],
    ['', ''],
    ['Call Reference Number', record.metadata.callReference],
    ['Call Date', record.metadata.callDate],
    ['Call Type', record.metadata.callType],
    ['Agent Name', record.metadata.agentName],
    ['Agent ID', record.metadata.agentId],
    ['Evaluator Name', record.metadata.evaluatorName],
    ['Audio Filename', record.metadata.fileName],
    ['Call Duration', formatDuration(record.metadata.durationSeconds)],
    ['Detected Languages', record.transcription.detectedLanguages.join(', ') || 'Unknown'],
    ['Total Transcript Segments', record.transcription.segments.length],
    ['AI Overall Score', hasScorecard ? `${record.aiOverallScore} / 100` : 'Not Evaluated'],
    ['Final Overall Score', hasScorecard ? `${record.overallScore} / 100` : 'Not Evaluated'],
    [
      'Assessed Max Marks (excluding Not Assessable)',
      hasScorecard ? `${record.assessedMaxMarks} / 100` : 'N/A',
    ],
    ['Performance Category', hasScorecard ? record.performanceBand : 'Pending Evaluation'],
    ['Manual Review Required', record.requiresManualReview ? 'Yes' : 'No'],
    ['Finalised By', record.finalisedBy || 'Not Finalised'],
    [
      'Finalised Timestamp',
      record.finalisedAt ? new Date(record.finalisedAt).toLocaleString() : 'N/A',
    ],
    ['Evaluator Notes', record.metadata.additionalNotes || 'None'],
  ]);
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 42 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Call Summary');

  // Sheet 2: CQM Scorecard
  const scorecardHeader = [
    'Call Reference',
    'Agent Name',
    'Agent ID',
    'Parameter',
    'Max Weight',
    'AI Marks',
    'Evaluator Marks',
    'Effective Final Marks',
    'Status',
    'Timestamp',
    'Evidence',
    'Reason for Score / Deduction',
    'Recommended Improvement',
    'Needs Human Review',
    'MCC System Check Required',
    'Review Decision',
    'Evaluator Comment',
  ];

  const scorecardRows = hasScorecard
    ? record.scorecard.map((item) => [
        record.metadata.callReference,
        record.metadata.agentName,
        record.metadata.agentId,
        item.parameterName,
        item.maxMarks,
        item.awardedMarks,
        item.evaluatorMarks !== null ? item.evaluatorMarks : '',
        item.status === 'Not Assessable' && item.evaluatorMarks === null
          ? 0
          : item.evaluatorMarks !== null
          ? item.evaluatorMarks
          : item.awardedMarks,
        item.status,
        item.timestamp,
        item.evidence,
        item.reason,
        item.recommendedImprovement,
        item.needsHumanReview ? 'Yes' : 'No',
        item.systemVerificationRequired ? 'Yes' : 'No',
        item.reviewDecision,
        item.evaluatorComment || '',
      ])
    : [
        [
          record.metadata.callReference,
          record.metadata.agentName,
          record.metadata.agentId,
          'CQM Evaluation Not Yet Run',
          100,
          0,
          '',
          0,
          'Not Assessable',
          'N/A',
          '',
          'This recording was transcribed only. Run CQM Evaluation to score all 11 parameters.',
          '',
          'Yes',
          'No',
          'pending',
          '',
        ],
      ];

  const scorecardTotalRow = hasScorecard
    ? [
        record.metadata.callReference,
        record.metadata.agentName,
        record.metadata.agentId,
        'TOTAL',
        record.scorecard.reduce((s, i) => s + i.maxMarks, 0),
        record.aiOverallScore,
        '',
        record.overallScore,
        record.performanceBand,
        '',
        `Assessed Max Marks: ${record.assessedMaxMarks} / 100`,
        '',
        '',
        record.requiresManualReview ? 'Review Flagged' : 'Clear',
        '',
        record.reviewState,
        '',
      ]
    : [];

  const scorecardSheetData = hasScorecard
    ? [scorecardHeader, ...scorecardRows, scorecardTotalRow]
    : [scorecardHeader, ...scorecardRows];
  const scorecardSheet = XLSX.utils.aoa_to_sheet(sanitizeRows(scorecardSheetData));
  scorecardSheet['!cols'] = [
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
    { wch: 11 },
    { wch: 10 },
    { wch: 15 },
    { wch: 18 },
    { wch: 18 },
    { wch: 11 },
    { wch: 36 },
    { wch: 42 },
    { wch: 38 },
    { wch: 18 },
    { wch: 22 },
    { wch: 15 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, scorecardSheet, 'CQM Scorecard');

  // Sheet 3: Feedback
  const feedbackRows: Array<Array<string | number>> = [
    [
      'Call Reference',
      record.metadata.callReference,
      'Agent',
      `${record.metadata.agentName} (${record.metadata.agentId})`,
    ],
    ['Final CQM Score', hasScorecard ? `${record.overallScore} / 100` : 'Pending Evaluation', 'Performance Band', hasScorecard ? record.performanceBand : 'Pending'],
    ['', '', '', ''],
    ['COACHING FEEDBACK', '', '', ''],
    ['Category', 'Feedback Detail', '', ''],
    ...(record.coachingFeedback.strengths.length > 0
      ? record.coachingFeedback.strengths.map((s) => ['Strength', s, '', ''])
      : [['Strength', 'No strengths recorded.', '', '']]),
    ...(record.coachingFeedback.areasForImprovement.length > 0
      ? record.coachingFeedback.areasForImprovement.map((a) => ['Area for Improvement', a, '', ''])
      : [['Area for Improvement', 'No improvement areas flagged.', '', '']]),
    ...(record.coachingFeedback.recommendedActions.length > 0
      ? record.coachingFeedback.recommendedActions.map((r) => [
          'Recommended Coaching Action',
          r,
          '',
          '',
        ])
      : [['Recommended Coaching Action', 'No specific actions recorded.', '', '']]),
    ['', '', '', ''],
    ['CRITICAL FINDINGS', '', '', ''],
    ['Category', 'Severity', 'Timestamp', 'Description / Evidence / Review Status'],
    ...(record.criticalFindings.length > 0
      ? record.criticalFindings.map((f) => [
          f.category,
          f.severity,
          f.timestamp,
          `[${f.status.toUpperCase()}] ${f.description}${f.evidence ? ` (Evidence: ${f.evidence})` : ''}`,
        ])
      : [['None', 'N/A', 'N/A', 'No critical findings recorded']]),
    ['', '', '', ''],
    ['FNOL PROCESS & MANDATORY QA CHECKS', '', '', ''],
    ['Rule Title', 'AI / Check Result', 'Timestamp', 'Evidence / Notes'],
    ...(record.fnolChecks.length > 0
      ? record.fnolChecks.map((c) => [
          c.ruleTitle,
          c.evaluatorConfirmed === true
            ? `${c.result} (Evaluator: Pass)`
            : c.evaluatorConfirmed === false
            ? `${c.result} (Evaluator: Fail)`
            : c.result,
          c.timestamp,
          `${c.evidence}${c.notes ? ` — ${c.notes}` : ''}`,
        ])
      : [['N/A', 'Pending', 'N/A', 'FNOL rules are evaluated when CQM Evaluation runs.']]),
  ];
  const feedbackSheet = XLSX.utils.aoa_to_sheet(sanitizeRows(feedbackRows));
  feedbackSheet['!cols'] = [{ wch: 34 }, { wch: 32 }, { wch: 16 }, { wch: 68 }];
  XLSX.utils.book_append_sheet(wb, feedbackSheet, 'Feedback');

  // Sheet 4: Transcription
  const transcriptHeader = [
    'Call Reference',
    'Segment #',
    'Timestamp',
    'Speaker',
    'Detected Language',
    'Transcribed Text (Singlish / English / Tamil)',
    'Roman Tamil (Optional)',
    'Confidence',
    'Uncertainty Note',
    'Manually Edited',
  ];
  const transcriptRows = record.transcription.segments.map((seg, i) => [
    record.metadata.callReference,
    i + 1,
    seg.timestamp,
    seg.speaker,
    seg.language,
    seg.text,
    seg.romanText || '',
    seg.confidence,
    seg.uncertaintyNote || '',
    seg.isEdited ? 'Yes' : 'No',
  ]);
  const transcriptSheet = XLSX.utils.aoa_to_sheet(
    sanitizeRows([transcriptHeader, ...transcriptRows])
  );
  transcriptSheet['!cols'] = [
    { wch: 18 },
    { wch: 10 },
    { wch: 11 },
    { wch: 11 },
    { wch: 24 },
    { wch: 68 },
    { wch: 40 },
    { wch: 12 },
    { wch: 32 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, transcriptSheet, 'Transcription');

  return wb;
}

export function exportSingleEvaluationToExcel(record: CallEvaluationRecord): void {
  const wb = buildSingleEvaluationWorkbook(record);
  const safeRef = (record.metadata.callReference || record.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `FNOL_CQM_${safeRef}_${record.metadata.callDate || 'export'}.xlsx`);
}

/**
 * Builds a multi-call QA report workbook covering:
 * 1. Report Summary
 * 2. Agent Performance
 * 3. Call Summary (Register)
 * 4. CQM Scorecard (Parameter Averages)
 * 5. Feedback
 * 6. Transcription
 */
export function buildFilteredReportWorkbook(
  records: CallEvaluationRecord[],
  reportTitle: string,
  filterSummary: string
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const evaluated = records.filter((r) => r.scorecard.length > 0);
  const total = evaluated.length;
  const avgScore =
    total > 0
      ? Math.round((evaluated.reduce((s, r) => s + r.overallScore, 0) / total) * 10) / 10
      : 0;
  const agentRows = computeAgentPerformanceRows(evaluated);

  // Sheet 1: Report Summary
  const summarySheet = XLSX.utils.aoa_to_sheet(
    sanitizeRows([
      [reportTitle, ''],
      ['Generated At', new Date().toLocaleString()],
      ['Applied Filters', filterSummary],
      ['Total Records Included', records.length],
      ['Evaluated Calls (Scored)', total],
      ['Transcript-Only Calls (Unscored)', records.length - total],
      ['Unique Agents Evaluated', agentRows.length],
      ['Average CQM Score', total > 0 ? `${avgScore} / 100` : 'N/A'],
      ['Excellent (>90)', evaluated.filter((r) => r.performanceBand === 'Excellent').length],
      ['Good (80–90)', evaluated.filter((r) => r.performanceBand === 'Good').length],
      ['Average (70–79.9)', evaluated.filter((r) => r.performanceBand === 'Average').length],
      ['Poor (<70)', evaluated.filter((r) => r.performanceBand === 'Poor').length],
      ['Evaluator Finalised Calls', evaluated.filter((r) => r.reviewState === 'finalised').length],
    ])
  );
  summarySheet['!cols'] = [{ wch: 34 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Report Summary');

  // Sheet 2: Agent Performance
  const agentHeader = [
    'Agent ID',
    'Agent Name',
    'Calls Evaluated',
    'Average CQM Score',
    'Min Score',
    'Max Score',
    'Excellent (>90)',
    'Good (80-90)',
    'Average (70-79.9)',
    'Poor (<70)',
    'Finalised Calls',
    'Critical Findings',
    'Lowest Scoring Parameter',
    'Lowest Parameter Avg %',
  ];
  const agentData = agentRows.map((a) => [
    a.agentId,
    a.agentName,
    a.callCount,
    a.avgScore,
    a.minScore,
    a.maxScore,
    a.excellentCount,
    a.goodCount,
    a.averageCount,
    a.poorCount,
    a.finalisedCount,
    a.criticalFindingsCount,
    a.weakestParameter,
    a.weakestParameterPct !== null ? `${a.weakestParameterPct}%` : 'N/A',
  ]);
  const agentSheet = XLSX.utils.aoa_to_sheet(sanitizeRows([agentHeader, ...agentData]));
  agentSheet['!cols'] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 15 },
    { wch: 18 },
    { wch: 11 },
    { wch: 11 },
    { wch: 15 },
    { wch: 14 },
    { wch: 17 },
    { wch: 11 },
    { wch: 15 },
    { wch: 16 },
    { wch: 24 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, agentSheet, 'Agent Performance');

  // Sheet 3: Call Summary (Register)
  const registerHeader = [
    'Call Reference',
    'Call Date',
    'Agent Name',
    'Agent ID',
    'Evaluator Name',
    'Duration',
    'Languages',
    'AI Score',
    'Final Score',
    'Performance Band',
    'Review State',
    'Critical Findings',
  ];
  const registerRows = records.map((r) => [
    r.metadata.callReference,
    r.metadata.callDate,
    r.metadata.agentName,
    r.metadata.agentId,
    r.metadata.evaluatorName,
    formatDuration(r.metadata.durationSeconds),
    r.transcription.detectedLanguages.join(', '),
    r.scorecard.length > 0 ? r.aiOverallScore : 'Pending',
    r.scorecard.length > 0 ? r.overallScore : 'Pending',
    r.scorecard.length > 0 ? r.performanceBand : 'Transcript Only',
    r.reviewState,
    r.criticalFindings.filter((f) => f.status !== 'rejected').length,
  ]);
  const registerSheet = XLSX.utils.aoa_to_sheet(sanitizeRows([registerHeader, ...registerRows]));
  registerSheet['!cols'] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
    { wch: 12 },
    { wch: 18 },
    { wch: 10 },
    { wch: 26 },
    { wch: 10 },
    { wch: 11 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, registerSheet, 'Call Summary');

  // Sheet 4: CQM Scorecard (Parameter Averages + Call Matrix)
  const paramMap = new Map<
    string,
    { name: string; maxMarks: number; totalAwarded: number; count: number; notAssessable: number }
  >();
  for (const rec of evaluated) {
    for (const p of rec.scorecard) {
      const existing = paramMap.get(p.parameterId) || {
        name: p.parameterName,
        maxMarks: p.maxMarks,
        totalAwarded: 0,
        count: 0,
        notAssessable: 0,
      };
      if (p.status === 'Not Assessable' && p.evaluatorMarks === null) {
        existing.notAssessable += 1;
      } else {
        existing.totalAwarded += p.evaluatorMarks !== null ? p.evaluatorMarks : p.awardedMarks;
        existing.count += 1;
      }
      paramMap.set(p.parameterId, existing);
    }
  }
  const paramHeader = [
    'Parameter',
    'Max Weight',
    'Assessed Calls',
    'Not Assessable Count',
    'Average Awarded Marks',
    'Average Attainment %',
  ];
  const paramRows = Array.from(paramMap.values()).map((p) => {
    const avg = p.count > 0 ? Math.round((p.totalAwarded / p.count) * 10) / 10 : 0;
    const pct = p.count > 0 && p.maxMarks > 0 ? Math.round((avg / p.maxMarks) * 1000) / 10 : 0;
    return [p.name, p.maxMarks, p.count, p.notAssessable, avg, `${pct}%`];
  });
  const paramSheet = XLSX.utils.aoa_to_sheet(sanitizeRows([paramHeader, ...paramRows]));
  paramSheet['!cols'] = [
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
    { wch: 20 },
    { wch: 22 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, paramSheet, 'CQM Scorecard');

  // Sheet 5: Feedback (Critical Findings + Coaching Notes)
  const feedbackHeader = [
    'Call Reference',
    'Agent Name',
    'Agent ID',
    'Entry Type',
    'Severity / Focus',
    'Timestamp',
    'Status',
    'Details',
    'Evidence',
  ];
  const feedbackRows: Array<Array<string>> = [];
  for (const rec of evaluated) {
    for (const f of rec.criticalFindings) {
      feedbackRows.push([
        rec.metadata.callReference,
        rec.metadata.agentName,
        rec.metadata.agentId,
        'Critical Finding',
        f.category,
        f.timestamp,
        `${f.severity} (${f.status})`,
        f.description,
        f.evidence,
      ]);
    }
    for (const s of rec.coachingFeedback.strengths) {
      feedbackRows.push([
        rec.metadata.callReference,
        rec.metadata.agentName,
        rec.metadata.agentId,
        'Coaching - Strength',
        'Strength',
        '',
        rec.performanceBand,
        s,
        '',
      ]);
    }
    for (const a of rec.coachingFeedback.areasForImprovement) {
      feedbackRows.push([
        rec.metadata.callReference,
        rec.metadata.agentName,
        rec.metadata.agentId,
        'Coaching - Improvement',
        'Area for Improvement',
        '',
        rec.performanceBand,
        a,
        '',
      ]);
    }
    for (const act of rec.coachingFeedback.recommendedActions) {
      feedbackRows.push([
        rec.metadata.callReference,
        rec.metadata.agentName,
        rec.metadata.agentId,
        'Coaching - Action',
        'Recommended Action',
        '',
        rec.performanceBand,
        act,
        '',
      ]);
    }
  }
  const feedbackSheet = XLSX.utils.aoa_to_sheet(sanitizeRows([feedbackHeader, ...feedbackRows]));
  feedbackSheet['!cols'] = [
    { wch: 18 },
    { wch: 20 },
    { wch: 12 },
    { wch: 22 },
    { wch: 22 },
    { wch: 10 },
    { wch: 16 },
    { wch: 52 },
    { wch: 44 },
  ];
  XLSX.utils.book_append_sheet(wb, feedbackSheet, 'Feedback');

  // Sheet 6: Transcription
  const transcriptHeader = [
    'Call Reference',
    'Agent Name',
    'Segment #',
    'Timestamp',
    'Speaker',
    'Detected Language',
    'Transcribed Text',
    'Roman Tamil (Optional)',
    'Manually Edited',
  ];
  const transcriptRows: Array<Array<string | number>> = [];
  for (const rec of records) {
    rec.transcription.segments.forEach((seg, idx) => {
      transcriptRows.push([
        rec.metadata.callReference,
        rec.metadata.agentName,
        idx + 1,
        seg.timestamp,
        seg.speaker,
        seg.language,
        seg.text,
        seg.romanText || '',
        seg.isEdited ? 'Yes' : 'No',
      ]);
    });
  }
  const transcriptSheet = XLSX.utils.aoa_to_sheet(
    sanitizeRows([transcriptHeader, ...transcriptRows])
  );
  transcriptSheet['!cols'] = [
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 11 },
    { wch: 22 },
    { wch: 64 },
    { wch: 36 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, transcriptSheet, 'Transcription');

  return wb;
}

export function exportFilteredReportToExcel(
  records: CallEvaluationRecord[],
  reportTitle: string,
  filterSummary: string,
  filePrefix = 'FNOL_CQM_Report'
): void {
  const wb = buildFilteredReportWorkbook(records, reportTitle, filterSummary);
  const stamp = new Date().toISOString().slice(0, 10);
  const safePrefix = filePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `${safePrefix}_${stamp}.xlsx`);
}
