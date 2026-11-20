import React, { useState } from 'react';
import { AlertTriangle, Check, Lock, RotateCcw, Trash2, Unlock } from 'lucide-react';
import { AppSettings } from '../types/cqm';
import { DEFAULT_SETTINGS } from '../constants/defaultSettings';

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
  onResetSettings: () => void;
  onClearAllLocalData: () => Promise<void>;
  totalStoredRecords: number;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onResetSettings,
  onClearAllLocalData,
  totalStoredRecords,
}) => {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [weightsUnlocked, setWeightsUnlocked] = useState(false);
  const [showWeightConfirmModal, setShowWeightConfirmModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);

  const totalWeight = draft.scorecard.reduce((s, p) => s + Number(p.weight || 0), 0);

  const handleSave = () => {
    setWeightError(null);
    if (totalWeight !== 100) {
      setWeightError(`Total CQM scorecard weight must equal 100 (currently ${totalWeight}).`);
      return;
    }
    onSaveSettings(draft);
    setSavedNotice('Settings saved to local browser storage.');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleReset = () => {
    setDraft(DEFAULT_SETTINGS);
    setWeightsUnlocked(false);
    setWeightError(null);
    onResetSettings();
    setSavedNotice('All settings restored to default FNOL CQM configuration.');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            System &amp; CQM Scorecard Settings
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Configure scorecard descriptions, FNOL evaluation rules, transcription display, thresholds, and local data retention.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Restore Defaults</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Save Settings</span>
          </button>
        </div>
      </div>

      {savedNotice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {savedNotice}
        </div>
      )}

      {weightError && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{weightError}</span>
        </div>
      )}

      {/* 1. CQM Scorecard Parameters & Weights */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              1. FNOL CQM Scorecard Parameters &amp; Descriptions
            </h2>
            <p className="text-xs text-slate-500">
              Total Weight:{' '}
              <span
                className={`font-mono font-semibold tabular-nums ${
                  totalWeight === 100 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {totalWeight} / 100
              </span>
            </p>
          </div>

          {!weightsUnlocked ? (
            <button
              type="button"
              onClick={() => setShowWeightConfirmModal(true)}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Lock className="h-3.5 w-3.5 text-slate-500" />
              <span>Unlock Default Weights</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <Unlock className="h-3.5 w-3.5" />
              <span>Weights Unlocked (Must total 100)</span>
            </span>
          )}
        </div>

        {showWeightConfirmModal && (
          <div className="border-b border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
            <div className="font-semibold">Confirm Scorecard Weight Modification</div>
            <p className="mt-1">
              Default FNOL CQM weights (Greeting 5, Active Listening 10, Identifying Query 10, Holding Procedure 10, Product Knowledge 10, Guidelines Order 10, Script Order 10, Data Protection 5, Courtesy 20, Call Duration 5, End Greeting 5 = 100) are standardized. Are you sure you want to unlock and edit weights?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setWeightsUnlocked(true);
                  setShowWeightConfirmModal(false);
                }}
                className="rounded bg-amber-700 px-3 py-1.5 font-medium text-white hover:bg-amber-800"
              >
                Yes, Unlock Weights
              </button>
              <button
                type="button"
                onClick={() => setShowWeightConfirmModal(false)}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700"
              >
                Keep Default Weights
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {draft.scorecard.map((param, idx) => (
            <div key={param.id} className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <div className="text-sm font-semibold text-slate-900">{param.name}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <label className="text-xs text-slate-500">Weight:</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!weightsUnlocked}
                    value={param.weight}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                      const next = [...draft.scorecard];
                      next[idx] = { ...param, weight: val };
                      setDraft({ ...draft, scorecard: next });
                    }}
                    className="w-16 rounded border border-slate-300 px-2 py-1 font-mono text-xs font-semibold tabular-nums disabled:bg-slate-100"
                  />
                </div>
              </div>

              <div className="lg:col-span-4">
                <label className="block text-[11px] font-medium text-slate-500">
                  Parameter Description
                </label>
                <textarea
                  rows={2}
                  value={param.description}
                  onChange={(e) => {
                    const next = [...draft.scorecard];
                    next[idx] = { ...param, description: e.target.value };
                    setDraft({ ...draft, scorecard: next });
                  }}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800"
                />
              </div>

              <div className="lg:col-span-5">
                <label className="block text-[11px] font-medium text-slate-500">
                  Evaluation Guideline
                </label>
                <textarea
                  rows={2}
                  value={param.guideline}
                  onChange={(e) => {
                    const next = [...draft.scorecard];
                    next[idx] = { ...param, guideline: e.target.value };
                    setDraft({ ...draft, scorecard: next });
                  }}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Configurable FNOL QA Rules */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            2. FNOL Process &amp; Mandatory QA Rules
          </h2>
          <p className="text-xs text-slate-500">
            Configure mandatory FNOL verification checks and MCC manual verification flags.
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {draft.qaRules.map((rule, idx) => (
            <div key={rule.id} className="py-3 grid grid-cols-1 gap-3 lg:grid-cols-12 items-start">
              <div className="lg:col-span-4 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => {
                    const next = [...draft.qaRules];
                    next[idx] = { ...rule, enabled: e.target.checked };
                    setDraft({ ...draft, qaRules: next });
                  }}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <div>
                  <div className="text-xs font-semibold text-slate-900">{rule.title}</div>
                  <label className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rule.requiresMccSystemCheck}
                      onChange={(e) => {
                        const next = [...draft.qaRules];
                        next[idx] = { ...rule, requiresMccSystemCheck: e.target.checked };
                        setDraft({ ...draft, qaRules: next });
                      }}
                    />
                    <span>Requires MCC System Verification</span>
                  </label>
                </div>
              </div>

              <div className="lg:col-span-8">
                <input
                  type="text"
                  value={rule.description}
                  onChange={(e) => {
                    const next = [...draft.qaRules];
                    next[idx] = { ...rule, description: e.target.value };
                    setDraft({ ...draft, qaRules: next });
                  }}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Language Handling, Display & Thresholds */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">
            3. Transcription &amp; Language Handling
          </h2>

          <div className="space-y-3 text-xs text-slate-700">
            <label className="flex items-center justify-between">
              <span>Enable Sinhala (displayed in Singlish / Roman Sinhala)</span>
              <input
                type="checkbox"
                checked={draft.languageHandling.enableSinhala}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    languageHandling: { ...draft.languageHandling, enableSinhala: e.target.checked },
                  })
                }
              />
            </label>

            <label className="flex items-center justify-between">
              <span>Enable English Transcription</span>
              <input
                type="checkbox"
                checked={draft.languageHandling.enableEnglish}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    languageHandling: { ...draft.languageHandling, enableEnglish: e.target.checked },
                  })
                }
              />
            </label>

            <label className="flex items-center justify-between">
              <span>Enable Tamil Transcription</span>
              <input
                type="checkbox"
                checked={draft.languageHandling.enableTamil}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    languageHandling: { ...draft.languageHandling, enableTamil: e.target.checked },
                  })
                }
              />
            </label>

            <label className="flex items-center justify-between">
              <span>Attempt Dedicated Transcription Model First (`gemini-3.5-transcribe`)</span>
              <input
                type="checkbox"
                checked={draft.languageHandling.preferDedicatedTranscriptionFirst}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    languageHandling: {
                      ...draft.languageHandling,
                      preferDedicatedTranscriptionFirst: e.target.checked,
                    },
                  })
                }
              />
            </label>

            <label className="flex items-center justify-between">
              <span>Show Confidence &amp; Fallback Warnings</span>
              <input
                type="checkbox"
                checked={draft.transcriptionPrefs.showConfidenceWarnings}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    transcriptionPrefs: {
                      ...draft.transcriptionPrefs,
                      showConfidenceWarnings: e.target.checked,
                    },
                  })
                }
              />
            </label>

            <div className="flex items-center justify-between pt-1">
              <span>Default Tamil Display Format</span>
              <select
                value={draft.transcriptionPrefs.tamilDisplay}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    transcriptionPrefs: {
                      ...draft.transcriptionPrefs,
                      tamilDisplay: e.target.value as 'script' | 'roman',
                    },
                  })
                }
                className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-900"
              >
                <option value="script">Original Tamil Script</option>
                <option value="roman">Roman Tamil</option>
              </select>
            </div>
          </div>
        </div>

        {/* Thresholds & Data Retention */}
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">
              4. Evaluation Performance Thresholds
            </h2>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-600">Excellent (&gt; X)</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={draft.thresholds.excellentMin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      thresholds: { ...draft.thresholds, excellentMin: Number(e.target.value) },
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-600">Good (&ge; X)</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={draft.thresholds.goodMin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      thresholds: { ...draft.thresholds, goodMin: Number(e.target.value) },
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-600">Average (&ge; X)</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={draft.thresholds.averageMin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      thresholds: { ...draft.thresholds, averageMin: Number(e.target.value) },
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Default bands: Below 70 = Poor, 70 to &lt;80 = Average, 80 to 90 = Good, Above 90 = Excellent.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">
              5. Data Retention &amp; Browser Privacy
            </h2>
            <div className="space-y-3 text-xs text-slate-700">
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="font-medium text-slate-900 block">
                    Retain Audio Recordings Locally in Browser
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Disabled by default for privacy. When disabled, audio is kept only in active session memory.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.dataRetention.retainAudioInBrowser}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      dataRetention: {
                        ...draft.dataRetention,
                        retainAudioInBrowser: e.target.checked,
                      },
                    })
                  }
                  className="mt-1"
                />
              </label>

              <div className="flex items-center justify-between">
                <span>Auto-purge Evaluation History After (Days, 0 = manual only)</span>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={draft.dataRetention.maxHistoryDays}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      dataRetention: {
                        ...draft.dataRetention,
                        maxHistoryDays: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                  className="w-20 rounded border border-slate-300 px-2.5 py-1 font-mono"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-slate-600">
                  Stored Records: <strong className="font-mono">{totalStoredRecords}</strong>
                </span>
                {!showClearConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(true)}
                    className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Clear All Local Data</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await onClearAllLocalData();
                        setShowClearConfirm(false);
                      }}
                      className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
                    >
                      Confirm Purge All
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(false)}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
