import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileSpreadsheet } from 'lucide-react';
import { CallEvaluationRecord, PerformanceBand } from '../types/cqm';
import { formatDuration } from '../utils/audio';
import {
  computeAgentPerformanceRows,
  exportFilteredReportToExcel,
  exportSingleEvaluationToExcel,
} from '../utils/excelExport';

interface ReportsViewProps {
  records: CallEvaluationRecord[];
  onOpenRecord: (recordId: string, targetTab: 'transcription' | 'evaluation') => void;
}

function fmtNum(val: unknown, digits = 1, fallback = '0.0'): string {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function getRecordDate(r: CallEvaluationRecord): Date {
  const raw = r?.metadata?.callDate || r?.createdAt || '';
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  return Number.isNaN(d.getTime()) ? new Date(r?.createdAt || Date.now()) : d;
}

function getScoreBarColor(score: number): string {
  if (score > 90) return '#15803D';
  if (score >= 80) return '#1D4ED8';
  if (score >= 70) return '#D97706';
  return '#DC2626';
}

function getBandTextClass(band: string): string {
  switch (band) {
    case 'Excellent':
      return 'text-emerald-700';
    case 'Good':
      return 'text-blue-700';
    case 'Average':
      return 'text-amber-700';
    default:
      return 'text-red-700';
  }
}

export const ReportsView: React.FC<ReportsViewProps> = ({ records, onOpenRecord }) => {
  const [reportCadence, setReportCadence] = useState<'weekly' | 'monthly' | 'all'>('all');
  const [selectedAgentKey, setSelectedAgentKey] = useState('ALL');
  const [agentName, setAgentName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [band, setBand] = useState<'ALL' | PerformanceBand>('ALL');

  const safeRecords = Array.isArray(records) ? records : [];

  const evaluatedRecords = useMemo(
    () => safeRecords.filter((r) => Array.isArray(r?.scorecard) && r.scorecard.length > 0),
    [safeRecords]
  );

  const uniqueAgents = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const r of evaluatedRecords) {
      const id = (r?.metadata?.agentId || '').trim();
      const name = (r?.metadata?.agentName || 'Unknown').trim();
      const key = (id || name).toLowerCase();
      if (!map.has(key)) {
        map.set(key, { key, label: id ? `${name} (${id})` : name });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [evaluatedRecords]);

  const filteredRecords = useMemo(() => {
    const now = Date.now();
    return evaluatedRecords.filter((r) => {
      if (reportCadence === 'weekly') {
        const d = getRecordDate(r);
        if (now - d.getTime() > 7 * 24 * 60 * 60 * 1000) return false;
      } else if (reportCadence === 'monthly') {
        const d = getRecordDate(r);
        if (now - d.getTime() > 30 * 24 * 60 * 60 * 1000) return false;
      }
      if (selectedAgentKey !== 'ALL') {
        const key = (
          (r?.metadata?.agentId || '').trim() || (r?.metadata?.agentName || '').trim()
        ).toLowerCase();
        if (key !== selectedAgentKey) return false;
      }
      if (
        agentName.trim() &&
        !(r?.metadata?.agentName || '').toLowerCase().includes(agentName.toLowerCase())
      ) {
        return false;
      }
      if (
        agentId.trim() &&
        !(r?.metadata?.agentId || '').toLowerCase().includes(agentId.toLowerCase())
      ) {
        return false;
      }
      if (dateFrom && (r?.metadata?.callDate || '') < dateFrom) return false;
      if (dateTo && (r?.metadata?.callDate || '') > dateTo) return false;
      const score = Number(r?.overallScore) || 0;
      if (minScore !== '' && score < Number(minScore)) return false;
      if (maxScore !== '' && score > Number(maxScore)) return false;
      if (band !== 'ALL' && r?.performanceBand !== band) return false;
      return true;
    });
  }, [
    evaluatedRecords,
    reportCadence,
    selectedAgentKey,
    agentName,
    agentId,
    dateFrom,
    dateTo,
    minScore,
    maxScore,
    band,
  ]);

  const agentBreakdown = useMemo(() => {
    try {
      const rows = computeAgentPerformanceRows(filteredRecords);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }, [filteredRecords]);

  const agentChartData = useMemo(
    () =>
      agentBreakdown.slice(0, 12).map((a) => ({
        agent: a?.agentId !== 'N/A' ? `${a?.agentName ?? ''} (${a?.agentId ?? ''})` : (a?.agentName ?? 'Unknown'),
        shortName: a?.agentName ?? 'Unknown',
        avgScore: Number(a?.avgScore) || 0,
        calls: Number(a?.callCount) || 0,
      })),
    [agentBreakdown]
  );

  const parameterBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; max: number; sum: number; count: number }>();
    for (const rec of filteredRecords) {
      const scorecard = Array.isArray(rec?.scorecard) ? rec.scorecard : [];
      for (const p of scorecard) {
        if (p?.status === 'Not Assessable' && p?.evaluatorMarks === null) continue;
        const curr = map.get(p.parameterId) || {
          name: p.parameterName,
          max: Number(p.maxMarks) || 0,
          sum: 0,
          count: 0,
        };
        curr.sum +=
          p?.evaluatorMarks !== null && p?.evaluatorMarks !== undefined
            ? Number(p.evaluatorMarks) || 0
            : Number(p?.awardedMarks) || 0;
        curr.count += 1;
        map.set(p.parameterId, curr);
      }
    }
    return Array.from(map.values()).map((item) => {
      const avg = item.count > 0 ? item.sum / item.count : 0;
      const pct = item.max > 0 ? Math.round((avg / item.max) * 1000) / 10 : 0;
      return {
        parameter: item.name,
        avgPct: pct,
        avgMarks: Math.round(avg * 10) / 10,
        maxMarks: item.max,
        assessedCount: item.count,
      };
    });
  }, [filteredRecords]);

  const summary = useMemo(() => {
    const count = filteredRecords.length;
    const avg =
      count > 0
        ? Math.round(
            (filteredRecords.reduce((s, r) => s + (Number(r?.overallScore) || 0), 0) / count) * 10
          ) / 10
        : 0;
    const criticalCount = filteredRecords.reduce(
      (s, r) =>
        s +
        (Array.isArray(r?.criticalFindings)
          ? r.criticalFindings.filter((f) => f?.status !== 'rejected').length
          : 0),
      0
    );
    return { count, uniqueAgents: agentBreakdown.length, avg, criticalCount };
  }, [filteredRecords, agentBreakdown]);

  const buildFilterSummary = () =>
    [
      reportCadence !== 'all' ? `Period=${reportCadence}` : null,
      selectedAgentKey !== 'ALL' ? `SelectedAgent=${selectedAgentKey}` : null,
      agentName ? `Agent=${agentName}` : null,
      agentId ? `AgentID=${agentId}` : null,
      dateFrom ? `From=${dateFrom}` : null,
      dateTo ? `To=${dateTo}` : null,
      minScore ? `MinScore=${minScore}` : null,
      maxScore ? `MaxScore=${maxScore}` : null,
      band !== 'ALL' ? `Band=${band}` : null,
    ]
      .filter(Boolean)
      .join(', ') || 'None';

  const handleExport = () => {
    const label =
      reportCadence === 'weekly'
        ? 'Weekly FNOL Quality Assurance Report (Last 7 Days)'
        : reportCadence === 'monthly'
        ? 'Monthly FNOL Quality Assurance Report (Last 30 Days)'
        : 'Filtered FNOL Quality Assurance Report';

    exportFilteredReportToExcel(filteredRecords, label, buildFilterSummary());
  };

  const handleExportAgent = (agentIdVal: string, agentNameVal: string) => {
    const key = (agentIdVal !== 'N/A' ? agentIdVal : agentNameVal).toLowerCase();
    const agentCalls = filteredRecords.filter(
      (r) =>
        ((r?.metadata?.agentId || '').trim() || (r?.metadata?.agentName || '').trim()).toLowerCase() ===
        key
    );
    if (agentCalls.length === 0) return;
    exportFilteredReportToExcel(
      agentCalls,
      `Agent CQM Performance Report — ${agentNameVal} (${agentIdVal})`,
      `Agent=${agentNameVal} (${agentIdVal})`,
      `FNOL_Agent_${agentIdVal !== 'N/A' ? agentIdVal : agentNameVal}`
    );
  };

  const resetFilters = () => {
    setSelectedAgentKey('ALL');
    setAgentName('');
    setAgentId('');
    setDateFrom('');
    setDateTo('');
    setMinScore('');
    setMaxScore('');
    setBand('ALL');
    setReportCadence('all');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Agent Performance &amp; QA Reports
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Generate weekly, monthly, or agent-wise FNOL CQM performance reports and export multi-sheet Excel workbooks.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={filteredRecords.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:bg-slate-300 whitespace-nowrap shrink-0"
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>Export Report to Excel (.xlsx)</span>
        </button>
      </div>

      {/* Report Cadence Tabs + Filters */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            {(
              [
                { id: 'all', label: 'All Time / Custom' },
                { id: 'weekly', label: 'Weekly Report (7 Days)' },
                { id: 'monthly', label: 'Monthly Report (30 Days)' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setReportCadence(tab.id)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  reportCadence === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
          >
            Reset Filters
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-8">
          <select
            value={selectedAgentKey}
            onChange={(e) => setSelectedAgentKey(e.target.value)}
            aria-label="Filter by agent"
            className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none lg:col-span-2"
          >
            <option value="ALL">All Agents ({uniqueAgents.length})</option>
            {uniqueAgents.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Agent Name"
            className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />
          <input
            type="text"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="Agent ID"
            className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Date from"
            className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Date to"
            className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />
          <div className="flex gap-1.5">
            <input
              type="number"
              min={0}
              max={100}
              value
