import React, { useMemo, useState } from 'react';
import { Download, Info, Search, Trash2 } from 'lucide-react';
import { CallEvaluationRecord, PerformanceBand } from '../types/cqm';
import { formatDuration } from '../utils/audio';
import { exportFilteredReportToExcel, exportSingleEvaluationToExcel } from '../utils/excelExport';

interface HistoryViewProps {
  records: CallEvaluationRecord[];
  onOpenRecord: (recordId: string, targetTab: 'transcription' | 'evaluation') => void;
  onDeleteRecords: (ids: string[]) => Promise<void>;
  onNavigateUpload: () => void;
}

type ReviewFilter = 'ALL' | 'ai_draft' | 'evaluator_reviewed' | 'finalised' | 'transcript_only';
type SortOrder = 'date_desc' | 'date_asc' | 'score_desc' | 'score_asc' | 'agent_asc';

function fmtNum(val: unknown, digits = 1, fallback = '0.0'): string {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  records,
  onOpenRecord,
  onDeleteRecords,
  onNavigateUpload,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [agentFilter, setAgentFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bandFilter, setBandFilter] = useState<'ALL' | PerformanceBand>('ALL');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('ALL');
  const [sortOrder, setSortOrder] = useState<SortOrder>('date_desc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const safeRecords = Array.isArray(records) ? records : [];

  const uniqueAgents = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const r of safeRecords) {
      const id = (r?.metadata?.agentId || '').trim();
      const name = (r?.metadata?.agentName || 'Unknown').trim();
      const key = (id || name).toLowerCase();
      if (!map.has(key)) {
        map.set(key, { key, label: id ? `${name} (${id})` : name });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [safeRecords]);

  const filtered = useMemo(() => {
    const list = safeRecords.filter((r) => {
      const isEvaluated = Array.isArray(r?.scorecard) && r.scorecard.length > 0;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchAgent = (r?.metadata?.agentName || '').toLowerCase().includes(q);
        const matchId = (r?.metadata?.agentId || '').toLowerCase().includes(q);
        const matchRef = (r?.metadata?.callReference || '').toLowerCase().includes(q);
        const matchEval = (r?.metadata?.evaluatorName || '').toLowerCase().includes(q);
        if (!matchAgent && !matchId && !matchRef && !matchEval) return false;
      }
      if (agentFilter !== 'ALL') {
        const key = (
          (r?.metadata?.agentId || '').trim() || (r?.metadata?.agentName || '').trim()
        ).toLowerCase();
        if (key !== agentFilter) return false;
      }
      if (dateFrom && (r?.metadata?.callDate || '') < dateFrom) return false;
      if (dateTo && (r?.metadata?.callDate || '') > dateTo) return false;
      if (bandFilter !== 'ALL') {
        if (!isEvaluated || r?.performanceBand !== bandFilter) return false;
      }
      if (reviewFilter !== 'ALL') {
        if (reviewFilter === 'transcript_only') {
          if (isEvaluated) return false;
        } else {
          if (!isEvaluated || r?.reviewState !== reviewFilter) return false;
        }
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortOrder === 'date_asc') {
        return (a?.metadata?.callDate || a?.createdAt || '').localeCompare(
          b?.metadata?.callDate || b?.createdAt || ''
        );
      }
      if (sortOrder === 'score_desc') {
        return (Number(b?.overallScore) || 0) - (Number(a?.overallScore) || 0);
      }
      if (sortOrder === 'score_asc') {
        return (Number(a?.overallScore) || 0) - (Number(b?.overallScore) || 0);
      }
      if (sortOrder === 'agent_asc') {
        return (a?.metadata?.agentName || '').localeCompare(b?.metadata?.agentName || '');
      }
      return (
        (b?.metadata?.callDate || b?.createdAt || '').localeCompare(
          a?.metadata?.callDate || a?.createdAt || ''
        ) ||
        new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()
      );
    });
  }, [safeRecords, searchTerm, agentFilter, dateFrom, dateTo, bandFilter, reviewFilter, sortOrder]);

  const filteredEvaluated = useMemo(
    () => filtered.filter((r) => Array.isArray(r?.scorecard) && r.scorecard.length > 0),
    [filtered]
  );

  const filteredAvg = useMemo(() => {
    if (filteredEvaluated.length === 0) return null;
    const sum = filteredEvaluated.reduce((s, r) => s + (Number(r?.overallScore) || 0), 0);
    return Math.round((sum / filteredEvaluated.length) * 10) / 10;
  }, [filteredEvaluated]);

  const hasActiveFilters =
    searchTerm.trim() !== '' ||
    agentFilter !== 'ALL' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    bandFilter !== 'ALL' ||
    reviewFilter !== 'ALL';

  const resetFilters = () => {
    setSearchTerm('');
    setAgentFilter('ALL');
    setDateFrom('');
    setDateTo('');
    setBandFilter('ALL');
    setReviewFilter('ALL');
    setSortOrder('date_desc');
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((r) => r.id));
    }
  };

  const handleExportSelected = () => {
    const selectedRecords = filtered.filter((r) => selectedIds.includes(r.id));
    if (selectedRecords.length === 1) {
      exportSingleEvaluationToExcel(selectedRecords[0]);
    } else if (selectedRecords.length > 1) {
      exportFilteredReportToExcel(
        selectedRecords,
        'Selected FNOL Evaluations Export',
        `${selectedRecords.length} selected records`
      );
    }
  };

  const handleDeleteSelected = async () => {
    await onDeleteRecords(selectedIds);
    setSelectedIds([]);
    setConfirmDelete(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Evaluation History &amp; Data Management
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Search, filter, sort, export to Excel, or manage locally stored FNOL evaluation records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportSelected}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export Selected ({selectedIds.length})</span>
              </button>

              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Selected ({selectedIds.length})</span>
                </button>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs">
                  <span className="font-medium text-red-900">Confirm delete?</span>
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="rounded bg-red-700 px-2 py-1 font-medium text-white hover:bg-red-800"
                  >
                    Yes, Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded bg-white px-2 py-1 font-medium text-slate-700 border border-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Browser-local data honesty notice */}
      <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs text-blue-950">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
        <div>
          <strong>Local Browser Storage Notice:</strong> Evaluation metadata, transcripts, and CQM scorecards are stored in this browser&apos;s IndexedDB. This data is <strong>not</strong> backed up to a cloud server and will be lost if you clear browser site data. Raw audio recordings are not permanently stored by default. Export important records to Excel (.xlsx) regularly.
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search Agent Name, ID, Call Ref, or Evaluator..."
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            aria-label="Filter by agent"
            className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            <option value="ALL">All Agents ({uniqueAgents.length})</option>
            {uniqueAgents.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Filter from date"
            className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Filter to date"
            className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />

          <select
            value={bandFilter}
            onChange={(e) => setBandFilter(e.target.value as 'ALL' | PerformanceBand)}
            aria-label="Filter by performance band"
            className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            <option value="ALL">All Performance Bands</option>
            <option value="Excellent">Excellent (&gt;90)</option>
            <option value="Good">Good (80–90)</option>
            <option value="Average">Average (70–79.9)</option>
            <option value="Poor">Poor (&lt;70)</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-3 text-slate-600">
            <span>
              Showing <strong className="font-mono text-slate-900">{filtered.length}</strong> of{' '}
              <strong className="font-mono text-slate-900">{safeRecords.length}</strong> records
            </span>
            {filteredAvg !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Filtered Avg CQM Score:{' '}
                  <strong className="font-mono text-blue-700">{fmtNum(filteredAvg, 1, '0.0')} / 100</strong>
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value as ReviewFilter)}
              aria-label="Filter by review state"
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="ALL">All Review States</option>
              <option value="finalised">Evaluator Finalised</option>
              <option value="evaluator_reviewed">Reviewed (Unfinalised)</option>
              <option value="ai_draft">AI Draft</option>
              <option value="transcript_only">Transcript Only (Pending Score)</option>
            </select>

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              aria-label="Sort evaluations"
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="date_desc">Sort: Newest Call Date</option>
              <option value="date_asc">Sort: Oldest Call Date</option>
              <option value="score_desc">Sort: Score High to Low</option>
              <option value="score_asc">Sort: Score Low to High</option>
              <option value="agent_asc">Sort: Agent Name (A–Z)</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="font-medium text-blue-700 hover:underline whitespace-nowrap"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-600">
              {safeRecords.length === 0
                ? 'No evaluation records found in local browser storage.'
                : 'No evaluations match your search or date filters.'}
            </p>
            {safeRecords.length === 0 && (
              <button
                type="button"
                onClick={onNavigateUpload}
                className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
              >
                Upload First Recording
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    aria-label="Select all evaluations"
                  />
                </th>
                <th className="px-3 py-3">Call Reference</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Call Date</th>
                <th className="px-4 py-3">Languages</th>
                <th className="px-4 py-3 text-right">Duration</th>
                <th className="px-4 py-3 text-right">Score</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Review</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((rec) => {
                const isEvaluated = Array.isArray(rec?.scorecard) && rec.scorecard.length > 0;
                const scoreOverridden =
                  isEvaluated &&
                  Math.abs((Number(rec?.overallScore) || 0) - (Number(rec?.aiOverallScore) || 0)) >
                    0.01;
                const activeFindings = Array.isArray(rec?.criticalFindings)
                  ? rec.criticalFindings.filter((f) => f?.status !== 'rejected').length
                  : 0;
                const langs = Array.isArray(rec?.transcription?.detectedLanguages)
                  ? rec.transcription.detectedLanguages.join(' · ')
                  : '';

                return (
                  <tr key={rec.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(rec.id)}
                        onChange={() => toggleSelect(rec.id)}
                        aria-label={`Select ${rec?.metadata?.callReference ?? rec.id}`}
                      />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="font-mono text-xs font-semibold text-slate-900">
                        {rec?.metadata?.callReference ?? '—'}
                      </div>
                      {activeFindings > 0 && (
                        <div className="text-[11px] font-medium text-red-700">
                          {activeFindings} critical {activeFindings === 1 ? 'finding' : 'findings'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{rec?.metadata?.agentName ?? '—'}</div>
                      <div className="font-mono text-xs text-slate-500">{rec?.metadata?.agentId ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                      {rec?.metadata?.callDate ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {langs || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                      {formatDuration(Number(rec?.metadata?.durationSeconds) || 0)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {isEvaluated ? (
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {fmtNum(rec?.overallScore, 1, '—')}
                          </div>
                          {scoreOverridden && (
                            <div className="text-[11px] text-slate-500">
                              AI: {fmtNum(rec?.aiOverallScore, 1, '0.0')}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold whitespace-nowrap">
                      {isEvaluated ? (
                        <span
                          className={
                            rec?.performanceBand === 'Excellent'
                              ? 'text-emerald-700'
                              : rec?.performanceBand === 'Good'
                              ? 'text-blue-700'
                              : rec?.performanceBand === 'Average'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }
                        >
                          {rec?.performanceBand ?? '—'}
                        </span>
                      ) : (
                        <span className="font-normal text-slate-500">Transcript Only</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {!isEvaluated
                        ? 'Pending Evaluation'
                        : rec?.reviewState === 'finalised'
                        ? 'Finalised'
                        : rec?.reviewState === 'evaluator_reviewed'
                        ? 'Reviewed'
                        : 'AI Draft'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenRecord(rec.id, 'transcription')}
                          className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Transcript
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenRecord(rec.id, 'evaluation')}
                          className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                        >
                          Scorecard
                        </button>
                        <button
                          type="button"
                          onClick={() => exportSingleEvaluationToExcel(rec)}
                          title="Export 4-sheet Excel workbook"
                          className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
