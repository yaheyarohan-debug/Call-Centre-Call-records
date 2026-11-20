import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Lock,
  MessageSquareWarning,
  Play,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import {
  AppSettings,
  CallEvaluationRecord,
  CqmParameterScore,
  EvaluationStatus,
} from '../types/cqm';
import { computePerformanceBand } from '../constants/defaultSettings';
import { formatDuration } from '../utils/audio';
import { exportSingleEvaluationToExcel } from '../utils/excelExport';
import { AudioPlayerBar } from './AudioPlayerBar';

interface EvaluationViewProps {
  record: CallEvaluationRecord | null;
  audioUrl: string | null;
  settings: AppSettings;
  onUpdateRecord: (updated: CallEvaluationRecord) => void;
  onOpenTranscription: () => void;
  onRunEvaluation: () => Promise<void>;
  isEvaluating: boolean;
  onDeleteAudio: () => void;
  onNavigateUpload: () => void;
}

const STATUS_OPTIONS: EvaluationStatus[] = [
  'Excellent',
  'Good',
  'Needs Improvement',
  'Failed',
  'Not Assessable',
];

function fmtNum(val: unknown, digits = 1, fallback = '0.0'): string {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function getStatusClasses(status: EvaluationStatus): string {
  switch (status) {
    case 'Excellent':
      return 'text-emerald-800 bg-emerald-50 border-emerald-200';
    case 'Good':
      return 'text-blue-800 bg-blue-50 border-blue-200';
    case 'Needs Improvement':
      return 'text-amber-800 bg-amber-50 border-amber-200';
    case 'Failed':
      return 'text-red-800 bg-red-50 border-red-200';
    default:
      return 'text-slate-700 bg-slate-100 border-slate-300';
  }
}

function getBandClasses(band: string): string {
  switch (band) {
    case 'Excellent':
      return 'text-emerald-800 bg-emerald-50 border-emerald-200';
    case 'Good':
      return 'text-blue-800 bg-blue-50 border-blue-200';
    case 'Average':
      return 'text-amber-800 bg-amber-50 border-amber-200';
    default:
      return 'text-red-800 bg-red-50 border-red-200';
  }
}

export const EvaluationView: React.FC<EvaluationViewProps> = ({
  record,
  audioUrl,
  settings,
  onUpdateRecord,
  onOpenTranscription,
  onRunEvaluation,
  isEvaluating,
  onDeleteAudio,
  onNavigateUpload,
}) => {
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; nonce: number } | null>(null);
  const [showTranscriptInline, setShowTranscriptInline] = useState(false);

  if (!record) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
        <h2 className="text-lg font-semibold text-slate-900">No CQM Evaluation Selected</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          Upload and analyse an FNOL call recording or select a previously evaluated call from Evaluation History.
        </p>
        <button
          type="button"
          onClick={onNavigateUpload}
          className="mt-5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
        >
          Upload Recording
        </button>
      </div>
    );
  }

  const scorecardList = Array.isArray(record.scorecard) ? record.scorecard : [];
  const transcriptSegments = Array.isArray(record.transcription?.segments)
    ? record.transcription.segments
    : [];
  const detectedLanguages = Array.isArray(record.transcription?.detectedLanguages)
    ? record.transcription.detectedLanguages
    : [];
  const fnolChecksList = Array.isArray(record.fnolChecks) ? record.fnolChecks : [];
  const criticalFindingsList = Array.isArray(record.criticalFindings)
    ? record.criticalFindings
    : [];

  if (scorecardList.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Transcript Ready — CQM Scorecard Not Yet Run
        </h2>
        <p className="mx-auto max-w-lg text-sm text-slate-600">
          Call{' '}
          <span className="font-mono font-semibold text-slate-800">
            {record?.metadata?.callReference ?? '—'}
          </span>{' '}
          has <span className="font-mono">{transcriptSegments.length}</span> transcribed segments.
          Review or edit the transcript, then run the 11-parameter FNOL CQM evaluation.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onOpenTranscription}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Review &amp; Edit Transcript
          </button>
          <button
            type="button"
            disabled={isEvaluating}
            onClick={onRunEvaluation}
            className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:bg-blue-400"
          >
            {isEvaluating ? 'Running CQM Evaluation...' : 'Run CQM Evaluation Now'}
          </button>
        </div>
      </div>
    );
  }

  const recalcAndSave = (
    nextScorecard: CqmParameterScore[],
    partial: Partial<CallEvaluationRecord> = {}
  ) => {
    const overallScore =
      Math.round(
        nextScorecard.reduce((sum, item) => {
          if (item.status === 'Not Assessable' && item.evaluatorMarks === null) return sum;
          const eff =
            item.evaluatorMarks !== null && item.evaluatorMarks !== undefined
              ? Number(item.evaluatorMarks) || 0
              : Number(item.awardedMarks) || 0;
          return sum + eff;
        }, 0) * 10
      ) / 10;

    const assessedMaxMarks = nextScorecard.reduce(
      (sum, item) => sum + (item.status === 'Not Assessable' ? 0 : Number(item.maxMarks) || 0),
      0
    );

    const nextBand = computePerformanceBand(overallScore, settings.thresholds);
    const hasAnyManualReview = nextScorecard.some(
      (p) => (p.needsHumanReview || p.systemVerificationRequired) && p.reviewDecision === 'pending'
    );

    const updated: CallEvaluationRecord = {
      ...record,
      ...partial,
      scorecard: nextScorecard,
      overallScore,
      assessedMaxMarks,
      performanceBand: nextBand,
      requiresManualReview: hasAnyManualReview,
      reviewState:
        partial.reviewState ||
        (record.reviewState === 'finalised' ? 'finalised' : 'evaluator_reviewed'),
      updatedAt: new Date().toISOString(),
    };
    onUpdateRecord(updated);
  };

  const handleParamScoreChange = (paramId: string, rawVal: string) => {
    const nextScorecard = scorecardList.map((item) => {
      if (item.parameterId !== paramId) return item;
      if (rawVal === '') {
        return {
          ...item,
          evaluatorMarks: null,
          reviewDecision: 'pending' as const,
        };
      }
      const num = Math.max(0, Math.min(Number(item.maxMarks) || 0, Number(rawVal)));
      const rounded = Number.isFinite(num) ? Math.round(num * 10) / 10 : 0;
      let nextStatus = item.status;
      if (item.status === 'Not Assessable') {
        const pct = item.maxMarks > 0 ? (rounded / item.maxMarks) * 100 : 0;
        nextStatus =
          pct >= 90 ? 'Excellent' : pct >= 75 ? 'Good' : pct >= 50 ? 'Needs Improvement' : 'Failed';
      }
      return {
        ...item,
        evaluatorMarks: rounded,
        status: nextStatus,
        reviewDecision: 'adjusted' as const,
      };
    });
    recalcAndSave(nextScorecard);
  };

  const handleResetParamScore = (paramId: string) => {
    const nextScorecard = scorecardList.map((item) => {
      if (item.parameterId !== paramId) return item;
      return {
        ...item,
        evaluatorMarks: null,
        reviewDecision: 'pending' as const,
      };
    });
    recalcAndSave(nextScorecard);
  };

  const handleParamStatusChange = (paramId: string, nextStatus: EvaluationStatus) => {
    const nextScorecard = scorecardList.map((item) => {
      if (item.parameterId !== paramId) return item;
      return {
        ...item,
        status: nextStatus,
        evaluatorMarks: nextStatus === 'Not Assessable' ? 0 : item.evaluatorMarks,
        reviewDecision: 'adjusted' as const,
      };
    });
    recalcAndSave(nextScorecard);
  };

  const handleParamDecision = (paramId: string, decision: 'confirmed' | 'rejected') => {
    const nextScorecard = scorecardList.map((item) => {
      if (item.parameterId !== paramId) return item;
      return {
        ...item,
        reviewDecision: decision,
        needsHumanReview: decision === 'confirmed' ? false : item.needsHumanReview,
      };
    });
    recalcAndSave(nextScorecard);
  };

  const handleParamComment = (paramId: string, comment: string) => {
    const nextScorecard = scorecardList.map((item) =>
      item.parameterId === paramId ? { ...item, evaluatorComment: comment } : item
    );
    recalcAndSave(nextScorecard);
  };

  const handleFindingDecision = (findingId: string, status: 'confirmed' | 'rejected') => {
    const nextFindings = criticalFindingsList.map((f) =>
      f.id === findingId ? { ...f, status } : f
    );
    onUpdateRecord({
      ...record,
      criticalFindings: nextFindings,
      reviewState: record.reviewState === 'finalised' ? 'finalised' : 'evaluator_reviewed',
      updatedAt: new Date().toISOString(),
    });
  };

  const handleRuleVerify = (ruleId: string, confirmed: boolean) => {
    const nextChecks = fnolChecksList.map((c) =>
      c.ruleId === ruleId
        ? {
            ...c,
            evaluatorConfirmed: confirmed,
            result: confirmed ? ('Passed' as const) : ('Failed' as const),
          }
        : c
    );
    onUpdateRecord({
      ...record,
      fnolChecks: nextChecks,
      reviewState: record.reviewState === 'finalised' ? 'finalised' : 'evaluator_reviewed',
      updatedAt: new Date().toISOString(),
    });
  };

  const handleCoachingNotesChange = (notes: string) => {
    onUpdateRecord({
      ...record,
      coachingNotes: notes,
      reviewState: record.reviewState === 'finalised' ? 'finalised' : 'evaluator_reviewed',
      updatedAt: new Date().toISOString(),
    });
  };

  const handleFinalise = () => {
    const confirmedScorecard = scorecardList.map((p) => ({
      ...p,
      reviewDecision: p.reviewDecision === 'pending' ? ('confirmed' as const) : p.reviewDecision,
      needsHumanReview: false,
    }));
    recalcAndSave(confirmedScorecard, {
      reviewState: 'finalised',
      finalisedAt: new Date().toISOString(),
      finalisedBy: record?.metadata?.evaluatorName || 'Quality Checker',
    });
  };

  const handleSeek = (seconds: number | null) => {
    if (seconds === null || !audioUrl) return;
    setSeekRequest({ seconds, nonce: Date.now() });
  };

  const isFinalised = record.reviewState === 'finalised';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono font-semibold text-slate-800">
              {record?.metadata?.callReference ?? '—'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {isFinalised
                ? `Finalised by ${record?.finalisedBy || 'Quality Checker'}`
                : record.reviewState === 'evaluator_reviewed'
                ? 'Evaluator Review In Progress'
                : 'AI-Generated Assessment (Pending Evaluator Confirmation)'}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            FNOL CQM Evaluation Results
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenTranscription}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Edit Transcription
          </button>
          <button
            type="button"
            onClick={() => exportSingleEvaluationToExcel(record)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            <span>Export Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={handleFinalise}
            disabled={isFinalised}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:bg-emerald-700 whitespace-nowrap shrink-0"
          >
            {isFinalised ? <Lock className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            <span>{isFinalised ? 'Evaluation Finalised' : 'Finalise Evaluation'}</span>
          </button>
        </div>
      </div>

      {/* Audio Player */}
      <AudioPlayerBar
        audioUrl={audioUrl}
        fileName={record?.metadata?.fileName ?? 'recording'}
        durationSeconds={Number(record?.metadata?.durationSeconds) || 0}
        seekRequest={seekRequest}
        onDeleteAudio={audioUrl ? onDeleteAudio : undefined}
        compact
      />

      {/* A. Call Summary */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <h2 className="text-sm font-semibold text-slate-900">A. Call Summary &amp; Overall Score</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              AI Score:{' '}
              <span className="font-mono font-semibold tabular-nums text-slate-800">
                {fmtNum(record?.aiOverallScore, 1, '0.0')}
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-300">|</span>
            <span
              className={`rounded border px-2.5 py-1 text-xs font-semibold ${getBandClasses(
                record?.performanceBand ?? ''
              )}`}
            >
              {record?.performanceBand ?? '—'}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <div>
            <div className="text-xs text-slate-500">Agent Name</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {record?.metadata?.agentName ?? '—'}
            </div>
            <div className="font-mono text-xs text-slate-500">{record?.metadata?.agentId ?? '—'}</div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Call Reference</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
              {record?.metadata?.callReference ?? '—'}
            </div>
            <div className="font-mono text-xs text-slate-500">{record?.metadata?.callDate ?? '—'}</div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Call Duration</div>
            <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">
              {formatDuration(Number(record?.metadata?.durationSeconds) || 0)}
            </div>
            <div className="text-xs text-slate-500">FNOL Call</div>
          </div>

          <div className="col-span-2 sm:col-span-1 lg:col-span-2">
            <div className="text-xs text-slate-500">Detected Languages</div>
            <div className="mt-1 text-sm font-medium text-slate-900">
              {detectedLanguages.join(', ') || 'Not specified'}
            </div>
            <div className="text-xs text-slate-500">
              Evaluator: {record?.metadata?.evaluatorName ?? '—'}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Assessed Weight</div>
            <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">
              {Number(record?.assessedMaxMarks) || 100} / 100
            </div>
            <div className="text-xs text-slate-500">Excl. Not Assessable</div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Final CQM Score</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-blue-700">
              {fmtNum(record?.overallScore, 1, '0.0')}
              <span className="text-sm font-normal text-slate-500"> / 100</span>
            </div>
          </div>
        </div>

        {record.requiresManualReview && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
            <span>
              One or more parameters are marked <strong>Not Assessable</strong> or require{' '}
              <strong>manual MCC system verification</strong>. Review flagged items below before finalising.
            </span>
          </div>
        )}
      </div>

      {/* B. Quick Collapsible Transcript Preview */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              B. Chronological Transcript ({transcriptSegments.length} turns)
            </h2>
            <p className="text-xs text-slate-500">
              Sinhala displayed in Singlish · Click timestamps to verify audio directly
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTranscriptInline((v) => !v)}
              className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {showTranscriptInline ? 'Hide Transcript' : 'Show Transcript'}
            </button>
            <button
              type="button"
              onClick={onOpenTranscription}
              className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              Full Editor
            </button>
          </div>
        </div>

        {showTranscriptInline && (
          <div className="max-h-80 overflow-y-auto border-t border-slate-200 divide-y divide-slate-100 px-5 py-2">
            {transcriptSegments.map((seg) => (
              <div key={seg.id} className="py-2.5 text-sm">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => handleSeek(seg.timestampSeconds)}
                    disabled={!audioUrl}
                    className="inline-flex items-center gap-1 font-mono font-medium text-blue-700 hover:underline disabled:opacity-50"
                  >
                    <Play className="h-2.5 w-2.5" />
                    {seg.timestamp}
                  </button>
                  <span className="font-semibold text-slate-800">{seg.speaker}</span>
                  <span>·</span>
                  <span>{seg.language}</span>
                </div>
                <p className="mt-1 text-slate-800">{seg.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* C. 11-Parameter CQM Scorecard */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              C. FNOL CQM Scorecard (11 Independent Parameters)
            </h2>
            <p className="text-xs text-slate-500">
              Adjust marks or confirm AI scoring. Total maximum weight is 100 marks.
            </p>
          </div>
          <div className="font-mono text-xs tabular-nums text-slate-600">
            AI Total: {fmtNum(record?.aiOverallScore, 1, '0.0')} · Final Total:{' '}
            {fmtNum(record?.overallScore, 1, '0.0')} / 100
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {scorecardList.map((param) => {
            const effectiveScore =
              param.evaluatorMarks !== null && param.evaluatorMarks !== undefined
                ? param.evaluatorMarks
                : param.awardedMarks;

            return (
              <div
                key={param.parameterId}
                className={`p-5 ${
                  param.needsHumanReview || param.status === 'Not Assessable'
                    ? 'bg-amber-50/25'
                    : ''
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-base font-semibold text-slate-900">
                        {param.parameterName}
                      </h3>
                      <span className="font-mono text-xs text-slate-500">
                        Weight: {param.maxMarks}
                      </span>
                      {param.needsHumanReview && (
                        <span className="text-xs font-medium text-amber-800">
                          · Flagged for Manual Review
                        </span>
                      )}
                      {param.systemVerificationRequired && (
                        <span className="text-xs font-medium text-blue-800">
                          · MCC System Verification Required
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">{param.reason}</p>
                  </div>

                  {/* Score & Status Controls */}
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500">AI Marks</div>
                      <div className="font-mono text-sm font-semibold tabular-nums text-slate-700">
                        {fmtNum(param.awardedMarks, 1, '0.0')} / {param.maxMarks}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="block text-[11px] text-slate-500">Final Marks</label>
                        {param.evaluatorMarks !== null && param.evaluatorMarks !== undefined && (
                          <button
                            type="button"
                            onClick={() => handleResetParamScore(param.parameterId)}
                            className="text-[11px] font-medium text-blue-700 hover:underline"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={param.maxMarks}
                        step={0.5}
                        value={
                          param.evaluatorMarks !== null && param.evaluatorMarks !== undefined
                            ? param.evaluatorMarks
                            : param.awardedMarks
                        }
                        onChange={(e) =>
                          handleParamScoreChange(param.parameterId, e.target.value)
                        }
                        className="mt-0.5 w-20 rounded border border-slate-300 px-2 py-1 font-mono text-sm font-semibold tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-500">Status</label>
                      <select
                        value={param.status}
                        onChange={(e) =>
                          handleParamStatusChange(
                            param.parameterId,
                            e.target.value as EvaluationStatus
                          )
                        }
                        className={`mt-0.5 rounded border px-2 py-1 text-xs font-semibold ${getStatusClasses(
                          param.status
                        )}`}
                      >
                        {STATUS_OPTIONS.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Evidence, Timestamp, Coaching */}
                <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs lg:grid-cols-2">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                      <span>Transcript Evidence</span>
                      {param.timestamp && param.timestamp !== 'N/A' && (
                        <button
                          type="button"
                          onClick={() => handleSeek(param.timestampSeconds)}
                          disabled={!audioUrl || param.timestampSeconds === null}
                          className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline disabled:opacity-50"
                        >
                          <Play className="h-2.5 w-2.5" />
                          <span>{param.timestamp}</span>
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-slate-600 italic">
                      {param.evidence || 'No direct quote recorded.'}
                    </p>
                  </div>

                  <div>
                    <div className="font-semibold text-slate-700">Recommended Improvement</div>
                    <p className="mt-1 text-slate-600">
                      {param.recommendedImprovement || 'No improvement needed.'}
                    </p>
                  </div>
                </div>

                {/* Evaluator Review Row */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <input
                    type="text"
                    value={param.evaluatorComment || ''}
                    onChange={(e) => handleParamComment(param.parameterId, e.target.value)}
                    placeholder="Add evaluator review comment or MCC check note..."
                    className="min-w-[260px] flex-1 rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                  />

                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <span className="text-slate-500">
                      Review:{' '}
                      <strong className="text-slate-800 capitalize">
                        {param.reviewDecision}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleParamDecision(param.parameterId, 'confirmed')}
                      className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-medium ${
                        param.reviewDecision === 'confirmed'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" />
                      <span>Confirm ({fmtNum(effectiveScore, 1, '0.0')})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleParamDecision(param.parameterId, 'rejected')}
                      className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-medium ${
                        param.reviewDecision === 'rejected'
                          ? 'border-red-300 bg-red-50 text-red-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <ThumbsDown className="h-3 w-3" />
                      <span>Reject AI</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* D. FNOL Process & Mandatory QA Checks */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            D. FNOL Process &amp; Mandatory Quality Checks
          </h2>
          <p className="text-xs text-slate-500">
            Items requiring MCC system inspection cannot be verified from audio alone and must be confirmed manually.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-5 py-3">QA Check</th>
                <th className="px-4 py-3">AI / System Status</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Evidence &amp; Notes</th>
                <th className="px-5 py-3 text-right">Evaluator Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fnolChecksList.map((chk) => (
                <tr key={chk.ruleId}>
                  <td className="px-5 py-3 font-medium text-slate-900">{chk.ruleTitle}</td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">
                    <span
                      className={
                        chk.result === 'Passed'
                          ? 'text-emerald-700'
                          : chk.result === 'Failed'
                          ? 'text-red-700'
                          : chk.result === 'Requires Manual MCC Verification'
                          ? 'text-blue-700'
                          : 'text-slate-600'
                      }
                    >
                      {chk.result}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                    {chk.timestamp}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{chk.evidence}</div>
                    {chk.notes && <div className="mt-0.5 text-slate-500">{chk.notes}</div>}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRuleVerify(chk.ruleId, true)}
                        className={`rounded border px-2 py-1 text-xs font-medium ${
                          chk.evaluatorConfirmed === true
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRuleVerify(chk.ruleId, false)}
                        className={`rounded border px-2 py-1 text-xs font-medium ${
                          chk.evaluatorConfirmed === false
                            ? 'border-red-300 bg-red-50 text-red-800'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Fail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* E. Critical Findings & Coaching Feedback */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Critical Findings */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <MessageSquareWarning className="h-4 w-4 text-red-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              E. Critical Findings ({criticalFindingsList.length})
            </h2>
          </div>

          {criticalFindingsList.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">
              No critical findings flagged for this call.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {criticalFindingsList.map((f) => (
                <div
                  key={f.id}
                  className="rounded-md border border-slate-200 bg-slate-50/60 p-3 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{f.title}</span>
                    <span className="font-mono text-[11px] text-slate-500">{f.timestamp}</span>
                  </div>
                  <p className="text-slate-600">{f.description}</p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-500 capitalize">Status: {f.status}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleFindingDecision(f.id, 'confirmed')}
                        className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                          f.status === 'confirmed'
                            ? 'border-red-300 bg-red-50 text-red-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFindingDecision(f.id, 'rejected')}
                        className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                          f.status === 'rejected'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coaching Feedback */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="border-b border-slate-100 pb-3 text-sm font-semibold text-slate-900">
            Coaching &amp; Evaluator Notes
          </h2>
          {record.overallSummary && (
            <div>
              <div className="text-xs font-semibold text-slate-700">AI Call Summary</div>
              <p className="mt-1 text-xs text-slate-600">{record.overallSummary}</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Evaluator Coaching Notes
            </label>
            <textarea
              rows={4}
              value={record.coachingNotes || ''}
              onChange={(e) => handleCoachingNotesChange(e.target.value)}
              placeholder="Write targeted coaching feedback for the agent..."
              className="mt-1.5 w-full rounded-md border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
