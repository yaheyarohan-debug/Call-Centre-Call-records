import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  FileAudio,
  History,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Settings as SettingsIcon,
  Upload,
  X,
} from 'lucide-react';
import { DashboardView } from './components/DashboardView';
import { EvaluationView } from './components/EvaluationView';
import { HistoryView } from './components/HistoryView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { TranscriptionView } from './components/TranscriptionView';
import { UploadRecordingView } from './components/UploadRecordingView';
import {
  AppSettings,
  CallEvaluationRecord,
  CallMetadata,
  TranscriptSegment,
} from './types/cqm';
import {
  clearAllLocalData,
  deleteAudioBlob,
  deleteEvaluations,
  enforceRetentionPolicy,
  getAudioBlob,
  listEvaluations,
  loadSettings,
  resetSettingsToDefault,
  saveAudioBlob,
  saveEvaluation,
  saveSettings,
} from './utils/storage';

type NavTab =
  | 'dashboard'
  | 'upload'
  | 'transcription'
  | 'evaluation'
  | 'history'
  | 'reports'
  | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'upload', label: 'Upload Recording', icon: Upload },
  { id: 'transcription', label: 'Call Transcription', icon: MessageSquareText },
  { id: 'evaluation', label: 'CQM Evaluation', icon: ClipboardCheck },
  { id: 'history', label: 'Evaluation History', icon: History },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [records, setRecords] = useState<CallEvaluationRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [sessionAudioUrls, setSessionAudioUrls] = useState<Record<string, string>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);

  // Load persisted evaluations and check backend Gemini readiness
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await enforceRetentionPolicy(settings.dataRetention.maxHistoryDays);
        const list = await listEvaluations();
        if (!mounted) return;
        setRecords(list);
        if (list.length > 0) {
          setActiveRecordId(list[0].id);
        }
      } catch (err) {
        if (mounted) {
          setGlobalError(
            err instanceof Error ? err.message : 'Unable to load local evaluation history.'
          );
        }
      } finally {
        if (mounted) setIsLoadingHistory(false);
      }

      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          if (mounted) setGeminiConfigured(Boolean(data.geminiConfigured));
        }
      } catch {
        // Ignore transient health check failure
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  const activeRecord = records.find((r) => r.id === activeRecordId) || null;
  const activeAudioUrl = activeRecordId ? sessionAudioUrls[activeRecordId] || null : null;

  // Attempt loading stored audio blob if user opted into retention and audio isn't in session memory
  useEffect(() => {
    if (!activeRecordId || sessionAudioUrls[activeRecordId]) return;
    const rec = records.find((r) => r.id === activeRecordId);
    if (!rec || !rec.hasStoredAudio) return;

    let cancelled = false;
    getAudioBlob(activeRecordId).then((blob) => {
      if (!cancelled && blob) {
        const url = URL.createObjectURL(blob);
        setSessionAudioUrls((prev) => ({ ...prev, [activeRecordId]: url }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeRecordId, records, sessionAudioUrls]);

  const handleAnalysisComplete = async (payload: {
    file: File;
    objectUrl: string;
    metadata: CallMetadata;
    transcription: any;
    evaluation: any | null;
  }) => {
    const id = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    let storedAudio = false;
    if (settings.dataRetention.retainAudioInBrowser) {
      try {
        await saveAudioBlob(id, payload.file, payload.file.name);
        storedAudio = true;
      } catch {
        storedAudio = false;
      }
    }

    const ev = payload.evaluation;
    const newRecord: CallEvaluationRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      metadata: payload.metadata,
      transcription: payload.transcription,
      scorecard: ev ? ev.scorecard : [],
      fnolChecks: ev ? ev.fnolChecks : [],
      criticalFindings: ev ? ev.criticalFindings : [],
      coachingFeedback: ev
        ? ev.coachingFeedback
        : { strengths: [], areasForImprovement: [], recommendedActions: [] },
      overallScore: ev ? ev.overallScore : 0,
      aiOverallScore: ev ? ev.aiOverallScore : 0,
      assessedMaxMarks: ev ? ev.assessedMaxMarks : 0,
      performanceBand: ev ? ev.performanceBand : 'Poor',
      requiresManualReview: ev ? ev.requiresManualReview : true,
      reviewState: 'ai_draft',
      hasStoredAudio: storedAudio,
    };

    await saveEvaluation(newRecord);
    setSessionAudioUrls((prev) => ({ ...prev, [id]: payload.objectUrl }));
    setRecords((prev) => [newRecord, ...prev]);
    setActiveRecordId(id);
    setActiveTab(ev ? 'evaluation' : 'transcription');
  };

  const handleUpdateRecord = async (updated: CallEvaluationRecord) => {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    await saveEvaluation(updated);
  };

  const handleUpdateSegments = async (segments: TranscriptSegment[]) => {
    if (!activeRecord) return;
    const detected = Array.from(new Set(segments.map((s) => s.language)));
    const updated: CallEvaluationRecord = {
      ...activeRecord,
      transcription: {
        ...activeRecord.transcription,
        segments,
        detectedLanguages: detected,
      },
      updatedAt: new Date().toISOString(),
    };
    await handleUpdateRecord(updated);
  };

  const handleRerunEvaluation = async () => {
    if (!activeRecord) return;
    setGlobalError(null);
    setIsReevaluating(true);
    try {
      const resp = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcriptSegments: activeRecord.transcription.segments,
          metadata: activeRecord.metadata,
          scorecardConfig: settings.scorecard,
          qaRules: settings.qaRules,
          thresholds: settings.thresholds,
          durationSeconds: activeRecord.metadata.durationSeconds,
        }),
      });
      const evalJson = await resp.json();
      if (!resp.ok) {
        throw new Error(evalJson.error || `Re-evaluation failed (HTTP ${resp.status}).`);
      }

      const updated: CallEvaluationRecord = {
        ...activeRecord,
        scorecard: evalJson.scorecard,
        fnolChecks: evalJson.fnolChecks,
        criticalFindings: evalJson.criticalFindings,
        coachingFeedback: evalJson.coachingFeedback,
        overallScore: evalJson.overallScore,
        aiOverallScore: evalJson.aiOverallScore,
        assessedMaxMarks: evalJson.assessedMaxMarks,
        performanceBand: evalJson.performanceBand,
        requiresManualReview: evalJson.requiresManualReview,
        reviewState: 'ai_draft',
        updatedAt: new Date().toISOString(),
      };
      await handleUpdateRecord(updated);
      setActiveTab('evaluation');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to re-evaluate transcript.');
    } finally {
      setIsReevaluating(false);
    }
  };

  const handleDeleteAudioForActive = async () => {
    if (!activeRecord) return;
    const url = sessionAudioUrls[activeRecord.id];
    if (url) {
      URL.revokeObjectURL(url);
      setSessionAudioUrls((prev) => {
        const copy = { ...prev };
        delete copy[activeRecord.id];
        return copy;
      });
    }
    if (activeRecord.hasStoredAudio) {
      await deleteAudioBlob(activeRecord.id);
      await handleUpdateRecord({ ...activeRecord, hasStoredAudio: false });
    }
  };

  const handleDeleteRecords = async (ids: string[]) => {
    for (const id of ids) {
      const url = sessionAudioUrls[id];
      if (url) URL.revokeObjectURL(url);
    }
    setSessionAudioUrls((prev) => {
      const copy = { ...prev };
      for (const id of ids) delete copy[id];
      return copy;
    });
    await deleteEvaluations(ids);
    const remaining = records.filter((r) => !ids.includes(r.id));
    setRecords(remaining);
    if (activeRecordId && ids.includes(activeRecordId)) {
      setActiveRecordId(remaining[0]?.id || null);
    }
  };

  const handleClearAllLocalData = async () => {
    Object.values(sessionAudioUrls).forEach((url) => URL.revokeObjectURL(url));
    setSessionAudioUrls({});
    await clearAllLocalData();
    setRecords([]);
    setActiveRecordId(null);
  };

  const handleSaveSettings = (next: AppSettings) => {
    saveSettings(next);
    setSettings(next);
  };

  const handleResetSettings = () => {
    const def = resetSettingsToDefault();
    setSettings(def);
  };

  const openRecord = (recordId: string, targetTab: 'transcription' | 'evaluation') => {
    setActiveRecordId(recordId);
    setActiveTab(targetTab);
  };

  const currentNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-700 text-white shrink-0">
            <FileAudio className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-bold tracking-tight text-slate-900">
              AI FNOL CQM
            </div>
            <div className="truncate text-[11px] text-slate-500">Quality Monitoring</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-400'}`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 text-xs text-slate-500">
          <div className="font-medium text-slate-700">Active Record</div>
          {activeRecord ? (
            <div className="mt-1 space-y-0.5">
              <div className="truncate font-mono font-medium text-slate-900">
                {activeRecord.metadata.callReference}
              </div>
              <div className="truncate">
                {activeRecord.metadata.agentName} ·{' '}
                <span className="font-mono font-semibold text-blue-700">
                  {activeRecord.overallScore.toFixed(1)}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-slate-400">No call loaded</div>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 flex flex-col">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <span className="font-display text-sm font-bold text-slate-900">AI FNOL CQM</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      isActive ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
              <span className="hidden sm:inline font-medium text-slate-700">
                AI FNOL Call Quality Monitoring System
              </span>
              <span className="hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-900 truncate">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload Recording</span>
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto space-y-5">
          {geminiConfigured === false && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <div>
                <strong>Gemini API Key Not Detected:</strong> Configure <code className="font-mono">GEMINI_API_KEY</code> in your environment Secrets panel so audio transcription and CQM evaluation endpoints can run.
              </div>
            </div>
          )}

          {globalError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{globalError}</span>
              </div>
              <button
                type="button"
                onClick={() => setGlobalError(null)}
                className="font-medium underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {isLoadingHistory ? (
            <div className="space-y-4">
              <div className="h-24 rounded-lg border border-slate-200 bg-white animate-pulse" />
              <div className="h-64 rounded-lg border border-slate-200 bg-white animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <DashboardView
                  records={records}
                  onNavigateUpload={() => setActiveTab('upload')}
                  onOpenRecord={openRecord}
                  onNavigateHistory={() => setActiveTab('history')}
                  onNavigateReports={() => setActiveTab('reports')}
                />
              )}

              {activeTab === 'upload' && (
                <UploadRecordingView
                  settings={settings}
                  onAnalysisComplete={handleAnalysisComplete}
                />
              )}

              {activeTab === 'transcription' && (
                <TranscriptionView
                  record={activeRecord}
                  audioUrl={activeAudioUrl}
                  settings={settings}
                  onUpdateSegments={handleUpdateSegments}
                  onRerunEvaluation={handleRerunEvaluation}
                  onDeleteAudio={handleDeleteAudioForActive}
                  onNavigateUpload={() => setActiveTab('upload')}
                  isEvaluating={isReevaluating}
                />
              )}

              {activeTab === 'evaluation' && (
                <EvaluationView
                  record={activeRecord}
                  audioUrl={activeAudioUrl}
                  settings={settings}
                  onUpdateRecord={handleUpdateRecord}
                  onOpenTranscription={() => setActiveTab('transcription')}
                  onRunEvaluation={handleRerunEvaluation}
                  isEvaluating={isReevaluating}
                  onDeleteAudio={handleDeleteAudioForActive}
                  onNavigateUpload={() => setActiveTab('upload')}
                />
              )}

              {activeTab === 'history' && (
                <HistoryView
                  records={records}
                  onOpenRecord={openRecord}
                  onDeleteRecords={handleDeleteRecords}
                  onNavigateUpload={() => setActiveTab('upload')}
                />
              )}

              {activeTab === 'reports' && (
                <ReportsView records={records} onOpenRecord={openRecord} />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  settings={settings}
                  onSaveSettings={handleSaveSettings}
                  onResetSettings={handleResetSettings}
                  onClearAllLocalData={handleClearAllLocalData}
                  totalStoredRecords={records.length}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
