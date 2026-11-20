import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Download, FileAudio, Upload } from 'lucide-react';
import { CallEvaluationRecord } from '../types/cqm';
import { formatDuration } from '../utils/audio';
import {
  computeAgentPerformanceRows,
  exportSingleEvaluationToExcel,
} from '../utils/excelExport';

interface DashboardViewProps {
  records: CallEvaluationRecord[];
  onNavigateUpload: () => void;
  onOpenRecord: (recordId: string, targetTab: 'transcription' | 'evaluation') => void;
  onNavigateHistory: () => void;
  onNavigateReports: () => void;
}

type DashboardScope = 'all' | 'weekly' | 'monthly';

const BAND_COLORS: Record<string, string> = {
  Excellent: '#15803D',
  Good: '#1D4ED8',
  Average: '#D97706',
  Poor: '#DC2626',
};

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

function getRecordDate(r: CallEvaluationRecord): Date {
  const raw = r.metadata.callDate || r.createdAt;
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  return Number.isNaN(d.getTime()) ? new Date(r.createdAt) : d;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  records,
  onNavigateUpload,
  onOpenRecord,
  onNavigateHistory,
  onNavigateReports,
}) => {
  const [scope, setScope] = useState<DashboardScope>('all');

  const scopedRecords = useMemo(() => {
    if (scope === 'all') return records;
    const now = Date.now();
    const windowMs = (scope === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000;
    return records.filter((r) => now - getRecordDate(r).getTime() <= windowMs);
  }, [records, scope]);

  const evaluatedRecords = useMemo(
    () => scopedRecords.filter((r) => r.scorecard.length > 0),
    [scopedRecords]
  );

  const allEvaluatedRecords = useMemo(
    () => records.filter((r) => r.scorecard.length > 0),
    [records]
  );

  const stats = useMemo(() => {
    const total = evaluatedRecords.length;
    const pendingEval = scopedRecords.length - total;
    const avg =
      total > 0
        ? Math.round((evaluatedRecords.reduce((sum, r) => sum + r.overallScore, 0) / total) * 10) /
          10
        : 0;
    const excellent = evaluatedRecords.filter((r) => r.performanceBand === 'Excellent').length;
    const good = evaluatedRecords.filter((r) => r.performanceBand === 'Good').length;
    const average = evaluatedRecords.filter((r) => r.performanceBand === 'Average').length;
    const poor = evaluatedRecords.filter((r) => r.performanceBand === 'Poor').length;
    return { total, pendingEval, avg, excellent, good, average, poor };
  }, [evaluatedRecords, scopedRecords]);

  const distributionData = useMemo(
    () => [
      { band: 'Excellent (>90)', key: 'Excellent', count: stats.excellent },
      { band: 'Good (80–90)', key: 'Good', count: stats.good },
      { band: 'Average (70–79)', key: 'Average', count: stats.average },
      { band: 'Poor (<70)', key: 'Poor', count: stats.poor },
    ],
    [stats]
  );

  // Weekly Performance Chart:
  // - In Weekly Dashboard mode: daily breakdown across matching 7-day calls
  // - Otherwise: ISO weekly trend across evaluated calls
  const weeklyData = useMemo(() => {
    if (scope === 'weekly') {
      const map = new Map<string, { label: string; total: number; count: number }>();
      for (const r of evaluatedRecords) {
        const d = getRecordDate(r);
        const key = d.toISOString().slice(0, 10);
        const existing = map.get(key) || {
          label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          total: 0,
          count: 0,
        };
        existing.total += r.overallScore;
        existing.count += 1;
        map.set(key, existing);
      }
      return Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => ({
          week: v.label,
          avgScore: Math.round((v.total / v.count) * 10) / 10,
          calls: v.count,
        }));
    }

    const map = new Map<string, { label: string; total: number; count: number }>();
    for (const r of allEvaluatedRecords) {
      const d = getRecordDate(r);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const key = monday.toISOString().slice(0, 10);
      const existing = map.get(key) || { label: key.slice(5), total: 0, count: 0 };
      existing.total += r.overallScore;
      existing.count += 1;
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([, v]) => ({
        week: `Wk ${v.label}`,
        avgScore: Math.round((v.total / v.count) * 10) / 10,
        calls: v.count,
      }));
  }, [scope, evaluatedRecords, allEvaluatedRecords]);

  // Monthly Performance Chart:
  // Shows monthly averages across evaluated calls
  const monthlyData = useMemo(() => {
    const source = scope === 'monthly' ? evaluatedRecords : allEvaluatedRecords;
    const map = new Map<string, { label: string; total: number; count: number }>();
    for (const r of source) {
      const d = getRecordDate(r);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const existing = map.get(key) || {
        label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        total: 0,
        count: 0,
      };
      existing.total += r.overallScore;
      existing.count += 1;
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([, v]) => ({
        month: v.label,
        avgScore: Math.round((v.total / v.count) * 10) / 10,
        calls: v.count,
      }));
  }, [scope, evaluatedRecords, allEvaluatedRecords]);

  const agentSnapshot = useMemo(
    () => computeAgentPerformanceRows(evaluatedRecords).slice(0, 5),
    [evaluatedRecords]
  );

  const recentRecords = scopedRecords.slice(0, 8);

  const scopeLabel =
    scope === 'weekly'
      ? 'Last 7 days'
      : scope === 'monthly'
      ? 'Last 30 days'
      : 'All stored calls';

  return (
    <div className="space-y-6">
      {/* Header Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            FNOL Quality Monitoring Overview
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Overall, weekly, and monthly CQM performance across First Notice of Loss recordings stored locally in this browser.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'all', label: 'All Time' },
                { id: 'weekly', label: 'Weekly Dashboard' },
                { id: 'monthly', label: 'Monthly Dashboard' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScope(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  scope === tab.id
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
            onClick={onNavigateUpload}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="h-4 w-4" />
            <span>Upload Recording</span>
          </button>
        </div>
      </div>

      {/* 6 Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Calls Evaluated</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {stats.total}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {scopeLabel}
            {stats.pendingEval > 0 ? ` · ${stats.pendingEval} unscored` : ''}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Average CQM Score</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-blue-700">
            {stats.total > 0 ? stats.avg.toFixed(1) : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500">Out of 100 marks</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Excellent Calls</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-emerald-700">
            {stats.excellent}
          </div>
          <div className="mt-1 text-xs text-slate-500">Score above 90</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Good Calls</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-blue-700">
            {stats.good}
          </div>
          <div className="mt-1 text-xs text-slate-500">Score 80 to 90</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Average Calls</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber-700">
            {stats.average}
          </div>
          <div className="mt-1 text-xs text-slate-500">Score 70 to &lt;80</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Poor Calls</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-red-700">
            {stats.poor}
          </div>
          <div className="mt-1 text-xs text-slate-500">Score below 70</div>
        </div>
      </div>

      {/* Empty State vs Charts */}
      {records.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <FileAudio className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">No Call Evaluations Yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">
            Upload a WAV or MP3 FNOL call recording to run real Gemini multilingual transcription (Singlish, English, Tamil) and evaluate all 11 CQM scorecard parameters.
          </p>
          <div className="mt-6">
            <button
              type="button"
              onClick={onNavigateUpload}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
            >
              <Upload className="h-4 w-4" />
              <span>Upload First Call Recording</span>
            </button>
          </div>
        </div>
      ) : scopedRecords.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            No Calls Recorded in {scope === 'weekly' ? 'the Last 7 Days' : 'the Last 30 Days'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Switch back to All Time or upload a new FNOL recording for this period.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setScope('all')}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Show All Time
            </button>
            <button
              type="button"
              onClick={onNavigateUpload}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
            >
              Upload Recording
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 3 Charts Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* CQM Score Distribution */}
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">CQM Score Distribution</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Calls grouped by band ({scopeLabel})
              </p>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distributionData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="key" tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, borderColor: '#E2E8F0', fontSize: 12 }}
                      formatter={(val) => [`${val} calls`, 'Count']}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {distributionData.map((entry) => (
                        <Cell key={entry.key} fill={BAND_COLORS[entry.key] || '#1D4ED8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Weekly Performance Chart */}
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                {scope === 'weekly' ? 'Daily Score Trend (7 Days)' : 'Weekly Performance'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {scope === 'weekly' ? 'Average CQM score by day' : 'Average CQM score by week'}
              </p>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, borderColor: '#E2E8F0', fontSize: 12 }}
                      formatter={(val) => [`${val} / 100`, 'Avg Score']}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgScore"
                      stroke="#1D4ED8"
                      strokeWidth={2}
                      dot={{ r: 4, fill: '#1D4ED8' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Monthly Performance Chart */}
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Monthly Performance</h2>
              <p className="mt-0.5 text-xs text-slate-500">Average CQM score by month</p>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, borderColor: '#E2E8F0', fontSize: 12 }}
                      formatter={(val) => [`${val} / 100`, 'Avg Score']}
                    />
                    <Bar dataKey="avgScore" fill="#1E40AF" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Agent Performance Snapshot */}
          {agentSnapshot.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Agent Performance Snapshot ({scopeLabel})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Top agents ranked by average CQM score
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onNavigateReports}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap shrink-0"
                >
                  <span>Full Agent Reports</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                      <th className="px-5 py-2.5">Agent</th>
                      <th className="px-4 py-2.5 text-right">Calls</th>
                      <th className="px-4 py-2.5 text-right">Avg Score</th>
                      <th className="px-4 py-2.5 text-right">Range</th>
                      <th className="px-4 py-2.5 text-right">Excellent</th>
                      <th className="px-4 py-2.5 text-right">Poor</th>
                      <th className="px-5 py-2.5">Lowest Parameter</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {agentSnapshot.map((agent) => (
                      <tr key={`${agent.agentId}-${agent.agentName}`} className="hover:bg-slate-50/70">
                        <td className="px-5 py-2.5">
                          <span className="font-medium text-slate-900">{agent.agentName}</span>{' '}
                          <span className="font-mono text-slate-500">· {agent.agentId}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          {agent.callCount}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-blue-700">
                          {agent.avgScore.toFixed(1)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                          {agent.minScore.toFixed(0)}–{agent.maxScore.toFixed(0)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700">
                          {agent.excellentCount}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-red-700">
                          {agent.poorCount}
                        </td>
                        <td className="px-5 py-2.5 text-slate-600">
                          {agent.weakestParameter}
                          {agent.weakestParameterPct !== null
                            ? ` (${agent.weakestParameterPct.toFixed(0)}%)`
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Evaluations & Uploads */}
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Recent Call Evaluations &amp; Uploads
                </h2>
                <p className="text-xs text-slate-500">Latest FNOL recordings ({scopeLabel})</p>
              </div>
              <button
                type="button"
                onClick={onNavigateHistory}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap shrink-0"
              >
                <span>View Full History</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="px-5 py-3">Call Ref</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Languages</th>
                    <th className="px-4 py-3 text-right">Duration</th>
                    <th className="px-4 py-3 text-right">CQM Score</th>
                    <th className="px-4 py-3">Band</th>
                    <th className="px-4 py-3">Review Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentRecords.map((rec) => {
                    const isEvaluated = rec.scorecard.length > 0;
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                          {rec.metadata.callReference}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{rec.metadata.agentName}</div>
                          <div className="font-mono text-xs text-slate-500">
                            {rec.metadata.agentId}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                          {rec.metadata.callDate}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {rec.transcription.detectedLanguages.join(' · ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                          {formatDuration(rec.metadata.durationSeconds)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                          {isEvaluated ? rec.overallScore.toFixed(1) : '—'}
                        </td>
                        <td
                          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap ${
                            isEvaluated ? getBandTextClass(rec.performanceBand) : 'text-slate-500'
                          }`}
                        >
                          {isEvaluated ? rec.performanceBand : 'Transcript Only'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                          {!isEvaluated
                            ? 'Pending Evaluation'
                            : rec.reviewState === 'finalised'
                            ? 'Evaluator Finalised'
                            : rec.reviewState === 'evaluator_reviewed'
                            ? 'Reviewed'
                            : 'AI Draft'}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                onOpenRecord(rec.id, isEvaluated ? 'evaluation' : 'transcription')
                              }
                              className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 whitespace-nowrap"
                            >
                              {isEvaluated ? 'Open Scorecard' : 'Open Transcript'}
                            </button>
                            <button
                              type="button"
                              onClick={() => exportSingleEvaluationToExcel(rec)}
                              title="Export to Excel"
                              className="inline-flex items-center justify-center rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
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
            </div>
          </div>
        </>
      )}
    </div>
  );
};
