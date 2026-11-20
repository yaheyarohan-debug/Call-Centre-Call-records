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

function getRecordDate(r: CallEvaluationRecord): Date {
  const raw = r.metadata.callDate || r.createdAt;
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  return Number.isNaN(d.getTime()) ? new Date(r.createdAt) : d;
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

  const evaluatedRecords = useMemo(
    () => records.filter((r) => r.scorecard.length > 0),
    [records]
  );

  const uniqueAgents = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const r of evaluatedRecords) {
      const id = (r.metadata.agentId || '').trim();
      const name = (r.metadata.agentName || 'Unknown').trim();
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
        const key = (r.metadata.agentId.trim() || r.metadata.agentName.trim()).toLowerCase();
        if (key !== selectedAgentKey) return false;
      }
      if (
        agentName.trim() &&
        !r.metadata.agentName.toLowerCase().includes(agentName.toLowerCase())
      ) {
        return false;
      }
      if (
        agentId.trim() &&
        !r.metadata.agentId.toLowerCase().includes(agentId.toLowerCase())
      ) {
        return false;
      }
      if (dateFrom && r.metadata.callDate < dateFrom) return false;
      if (dateTo && r.metadata.callDate > dateTo) return false;
      if (minScore !== '' && r.overallScore < Number(minScore)) return false;
      if (maxScore !== '' && r.overallScore > Number(maxScore)) return false;
      if (band !== 'ALL' && r.performanceBand !== band) return false;
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

  const agentBreakdown = useMemo(
    () => computeAgentPerformanceRows(filteredRecords),
    [filteredRecords]
  );

  const agentChartData = useMemo(
    () =>
      agentBreakdown.slice(0, 12).map((a) => ({
        agent: a.agentId !== 'N/A' ? `${a.agentName} (${a.agentId})` : a.agentName,
        shortName: a.agentName,
        avgScore: a.avgScore,
        calls: a.callCount,
      })),
    [agentBreakdown]
  );

  const parameterBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; max: number; sum: number; count: number }>();
    for (const rec of filteredRecords) {
      for (const p of rec.scorecard) {
        if (p.status === 'Not Assessable' && p.evaluatorMarks === null) continue;
        const curr = map.get(p.parameterId) || {
          name: p.parameterName,
          max: p.maxMarks,
          sum: 0,
          count: 0,
        };
        curr.sum += p.evaluatorMarks !== null ? p.evaluatorMarks : p.awardedMarks;
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
        ? Math.round((filteredRecords.reduce((s, r) => s + r.overallScore, 0) / count) * 10) / 10
        : 0;
    const criticalCount = filteredRecords.reduce(
      (s, r) => s + r.criticalFindings.filter((f) => f.status !== 'rejected').length,
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
      (r) => (r.metadata.agentId.trim() || r.metadata.agentName.trim()).toLowerCase() === key
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
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder="Min"
              aria-label="Minimum score"
              className="w-1/2 rounded-md border border-slate-300 px-2 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              placeholder="Max"
              aria-label="Maximum score"
              className="w-1/2 rounded-md border border-slate-300 px-2 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <select
            value={band}
            onChange={(e) => setBand(e.target.value as 'ALL' | PerformanceBand)}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            <option value="ALL">All Categories</option>
            <option value="Excellent">Excellent</option>
            <option value="Good">Good</option>
            <option value="Average">Average</option>
            <option value="Poor">Poor</option>
          </select>
        </div>
      </div>

      {/* Report Metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Matching Evaluated Calls</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {summary.count}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Agents Evaluated</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {summary.uniqueAgents}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Average CQM Score</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-blue-700">
            {summary.count > 0 ? `${summary.avg.toFixed(1)} / 100` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Confirmed / Pending Critical Findings</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-red-700">
            {summary.criticalCount}
          </div>
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
          No evaluated calls match the selected report period and filters.
        </div>
      ) : (
        <>
          {/* Agent-Wise Performance Report */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Agent-Wise Average CQM Score
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Comparison across agents matching current filters
              </p>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={agentChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 16, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis
                      type="category"
                      dataKey="shortName"
                      width={110}
                      tick={{ fontSize: 11, fill: '#334155' }}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, borderColor: '#E2E8F0', fontSize: 12 }}
                      formatter={(val, _name, item) => [
                        `${val} / 100 (${item?.payload?.calls || 0} calls)`,
                        'Avg CQM Score',
                      ]}
                    />
                    <Bar dataKey="avgScore" radius={[0, 4, 4, 0]}>
                      {agentChartData.map((entry) => (
                        <Cell key={entry.agent} fill={getScoreBarColor(entry.avgScore)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto lg:col-span-7">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Agent-Wise Performance Breakdown
                  </h2>
                  <p className="text-xs text-slate-500">
                    Score range, category counts, and lowest parameter for targeted coaching
                  </p>
                </div>
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-4 py-2.5">Agent</th>
                    <th className="px-3 py-2.5 text-right">Calls</th>
                    <th className="px-3 py-2.5 text-right">Avg</th>
                    <th className="px-3 py-2.5 text-right">Min–Max</th>
                    <th className="px-3 py-2.5 text-right">Exc / Good / Avg / Poor</th>
                    <th className="px-3 py-2.5">Weakest Parameter</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {agentBreakdown.map((agent) => {
                    const key = (agent.agentId !== 'N/A' ? agent.agentId : agent.agentName).toLowerCase();
                    return (
                      <tr key={key} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900">{agent.agentName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {agent.agentId}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          {agent.callCount}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-blue-700">
                          {agent.avgScore.toFixed(1)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {agent.minScore.toFixed(0)}–{agent.maxScore.toFixed(0)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          <span className="text-emerald-700">{agent.excellentCount}</span> /{' '}
                          <span className="text-blue-700">{agent.goodCount}</span> /{' '}
                          <span className="text-amber-700">{agent.averageCount}</span> /{' '}
                          <span className="text-red-700">{agent.poorCount}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {agent.weakestParameter}
                          {agent.weakestParameterPct !== null && (
                            <span className="font-mono text-slate-500">
                              {' '}
                              ({agent.weakestParameterPct.toFixed(0)}%)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedAgentKey(selectedAgentKey === key ? 'ALL' : key)
                              }
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {selectedAgentKey === key ? 'Show All' : 'Focus'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportAgent(agent.agentId, agent.agentName)}
                              title="Export Agent Report to Excel"
                              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                            >
                              <Download className="h-3 w-3" />
                              <span>Excel</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Parameter Performance Chart + Table */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
              <h2 className="text-sm font-semibold text-slate-900">
                CQM Parameter Average Attainment (%)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Excludes parameters marked Not Assessable
              </p>
              <div className="mt-4 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={parameterBreakdown}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 32, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#475569' }}
                      unit="%"
                    />
                    <YAxis
                      type="category"
                      dataKey="parameter"
                      width={120}
                      tick={{ fontSize: 11, fill: '#334155' }}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, borderColor: '#E2E8F0', fontSize: 12 }}
                      formatter={(val) => [`${val}%`, 'Avg Attainment']}
                    />
                    <Bar dataKey="avgPct" fill="#1D4ED8" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto lg:col-span-5">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Parameter Summary Table</h2>
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-4 py-2.5">Parameter</th>
                    <th className="px-3 py-2.5 text-right">Weight</th>
                    <th className="px-3 py-2.5 text-right">Avg Marks</th>
                    <th className="px-4 py-2.5 text-right">Avg %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parameterBreakdown.map((p) => (
                    <tr key={p.parameter}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{p.parameter}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                        {p.maxMarks}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900">
                        {p.avgMarks.toFixed(1)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-blue-700">
                        {p.avgPct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Matching Calls Register */}
          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">
                Calls Included in Report ({filteredRecords.length})
              </h2>
              <p className="text-xs text-slate-500">
                Open any call scorecard or export an individual 4-sheet workbook (Call Summary, CQM Scorecard, Feedback, Transcription)
              </p>
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-5 py-2.5">Call Ref</th>
                  <th className="px-4 py-2.5">Agent</th>
                  <th className="px-4 py-2.5">Call Date</th>
                  <th className="px-4 py-2.5 text-right">Duration</th>
                  <th className="px-4 py-2.5 text-right">Final Score</th>
                  <th className="px-4 py-2.5">Band</th>
                  <th className="px-4 py-2.5">Review</th>
                  <th className="px-5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {rec.metadata.callReference}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-900">{rec.metadata.agentName}</span>{' '}
                      <span className="font-mono text-slate-500">({rec.metadata.agentId})</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {rec.metadata.callDate}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatDuration(rec.metadata.durationSeconds)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                      {rec.overallScore.toFixed(1)}
                    </td>
                    <td className={`px-4 py-2.5 font-semibold whitespace-nowrap ${getBandTextClass(rec.performanceBand)}`}>
                      {rec.performanceBand}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                      {rec.reviewState === 'finalised'
                        ? 'Finalised'
                        : rec.reviewState === 'evaluator_reviewed'
                        ? 'Reviewed'
                        : 'AI Draft'}
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenRecord(rec.id, 'evaluation')}
                          className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100"
                        >
                          Scorecard
                        </button>
                        <button
                          type="button"
                          onClick={() => exportSingleEvaluationToExcel(rec)}
                          title="Export 4-sheet Excel workbook"
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="h-3 w-3" />
                          <span>4-Sheet .xlsx</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
