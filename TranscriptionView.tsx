import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Edit3,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
} from 'lucide-react';
import {
  AppSettings,
  CallEvaluationRecord,
  DetectedLanguage,
  SpeakerRole,
  TranscriptSegment,
} from '../types/cqm';
import { AudioPlayerBar } from './AudioPlayerBar';

interface TranscriptionViewProps {
  record: CallEvaluationRecord | null;
  audioUrl: string | null;
  settings: AppSettings;
  onUpdateSegments: (segments: TranscriptSegment[]) => void;
  onRerunEvaluation: () => Promise<void>;
  onDeleteAudio: () => void;
  onNavigateUpload: () => void;
  isEvaluating: boolean;
}

const LANGUAGE_OPTIONS: DetectedLanguage[] = [
  'Sinhala (Singlish)',
  'English',
  'Tamil',
  'Mixed (Sinhala/English)',
  'Mixed (Tamil/English)',
  'Unclear',
];

export const TranscriptionView: React.FC<TranscriptionViewProps> = ({
  record,
  audioUrl,
  settings,
  onUpdateSegments,
  onRerunEvaluation,
  onDeleteAudio,
  onNavigateUpload,
  isEvaluating,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState<'ALL' | SpeakerRole>('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftRomanText, setDraftRomanText] = useState('');
  const [draftTimestamp, setDraftTimestamp] = useState('');
  const [draftLanguage, setDraftLanguage] = useState<DetectedLanguage>('Sinhala (Singlish)');
  const [tamilFormat, setTamilFormat] = useState<'script' | 'roman'>(
    settings.transcriptionPrefs.tamilDisplay
  );
  const [isConvertingSinglish, setIsConvertingSinglish] = useState(false);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; nonce: number } | null>(null);

  const segments = record?.transcription.segments || [];

  const filteredSegments = useMemo(() => {
    return segments.filter((seg) => {
      if (speakerFilter !== 'ALL' && seg.speaker !== speakerFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          seg.text.toLowerCase().includes(q) ||
          (seg.romanText || '').toLowerCase().includes(q) ||
          seg.language.toLowerCase().includes(q) ||
          seg.timestamp.includes(q)
        );
      }
      return true;
    });
  }, [segments, speakerFilter, searchQuery]);

  if (!record) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
        <h2 className="text-lg font-semibold text-slate-900">No Active Call Recording Loaded</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          Upload a WAV or MP3 call recording or open an evaluated call from Evaluation History to inspect and edit its multilingual transcription.
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

  const handleSeek = (seconds: number) => {
    setSeekRequest({ seconds, nonce: Date.now() });
  };

  const toggleSpeaker = (segmentId: string) => {
    const updated = segments.map((s) =>
      s.id === segmentId
        ? { ...s, speaker: (s.speaker === 'Agent' ? 'Customer' : 'Agent') as SpeakerRole, isEdited: true }
        : s
    );
    onUpdateSegments(updated);
  };

  const swapAllSpeakers = () => {
    const updated = segments.map((s) => ({
      ...s,
      speaker: (s.speaker === 'Agent' ? 'Customer' : 'Agent') as SpeakerRole,
      isEdited: true,
    }));
    onUpdateSegments(updated);
  };

  const startEditing = (seg: TranscriptSegment) => {
    setEditingId(seg.id);
    setDraftText(seg.text);
    setDraftRomanText(seg.romanText || '');
    setDraftTimestamp(seg.timestamp);
    setDraftLanguage(seg.language);
  };

  const saveEditing = (segmentId: string) => {
    const parts = draftTimestamp.split(':').map(Number);
    const tsSec =
      parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])
        ? Math.max(0, parts[0] * 60 + parts[1])
        : 0;

    const updated = segments.map((s) =>
      s.id === segmentId
        ? {
            ...s,
            text: draftText.trim() || '[Unclear audio]',
            romanText: draftRomanText.trim() || undefined,
            timestamp: draftTimestamp.trim() || s.timestamp,
            timestampSeconds: tsSec,
            language: draftLanguage,
            isEdited: true,
          }
        : s
    );
    onUpdateSegments(updated);
    setEditingId(null);
  };

  const deleteSegment = (segmentId: string) => {
    onUpdateSegments(segments.filter((s) => s.id !== segmentId));
  };

  const addNewSegment = () => {
    const lastSec = segments.length > 0 ? segments[segments.length - 1].timestampSeconds + 5 : 0;
    const mins = Math.floor(lastSec / 60);
    const secs = lastSec % 60;
    const ts = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const newSeg: TranscriptSegment = {
      id: `seg-manual-${Date.now()}`,
      speaker: 'Agent',
      timestamp: ts,
      timestampSeconds: lastSec,
      language: 'Sinhala (Singlish)',
      text: '',
      confidence: 'high',
      isEdited: true,
    };
    onUpdateSegments([...segments, newSeg]);
    startEditing(newSeg);
  };

  const warnings = record.transcription.processingMeta?.warnings || [];

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Multilingual Call Transcription
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-mono font-medium text-slate-900">
              {record.metadata.callReference}
            </span>
            <span aria-hidden="true">·</span>
            <span>Agent: {record.metadata.agentName}</span>
            <span aria-hidden="true">·</span>
            <span>
              Languages: {record.transcription.detectedLanguages.join(', ') || 'Pending'}
            </span>
            {record.transcription.processingMeta?.audioUnderstandingModel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-500">
                  Model: {record.transcription.processingMeta.audioUnderstandingModel}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={swapAllSpeakers}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <UserCheck className="h-3.5 w-3.5" />
            <span>Swap All Agent/Customer</span>
          </button>

          <button
            type="button"
            onClick={onRerunEvaluation}
            disabled={isEvaluating}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:bg-blue-400 whitespace-nowrap shrink-0"
          >
            {isEvaluating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>
              {isEvaluating
                ? 'Evaluating Call...'
                : record.scorecard.length === 0
                ? 'Run CQM Evaluation'
                : 'Re-run CQM Evaluation on Edited Transcript'}
            </span>
          </button>
        </div>
      </div>

      {/* Audio Player Bar */}
      <AudioPlayerBar
        audioUrl={audioUrl}
        fileName={record.metadata.fileName}
        durationSeconds={record.metadata.durationSeconds}
        seekRequest={seekRequest}
        onDeleteAudio={audioUrl ? onDeleteAudio : undefined}
      />

      {/* Processing & Reliability Warnings */}
      {settings.transcriptionPrefs.showConfidenceWarnings && warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="space-y-1">
              <div className="font-semibold">Transcription Model &amp; Reliability Notes</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Display Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search words, language, timestamp..."
              className="w-64 rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            {(['ALL', 'Agent', 'Customer'] as const).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setSpeakerFilter(role)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  speakerFilter === role
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {role === 'ALL' ? 'All Speakers' : role}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>Tamil Display:</span>
            <div className="flex items-center rounded-md bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => setTamilFormat('script')}
                className={`rounded px-2 py-1 text-xs font-medium whitespace-nowrap ${
                  tamilFormat === 'script' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Original Script
              </button>
              <button
                type="button"
                onClick={() => setTamilFormat('roman')}
                className={`rounded px-2 py-1 text-xs font-medium whitespace-nowrap ${
                  tamilFormat === 'roman' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Roman Tamil
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={addNewSegment}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Segment</span>
          </button>
        </div>
      </div>

      {/* Chronological Conversation List */}
      <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
        {filteredSegments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No transcript segments match the current filter.
          </div>
        ) : (
          filteredSegments.map((seg) => {
            const isAgent = seg.speaker === 'Agent';
            const isEditing = editingId === seg.id;
            const displayText =
              tamilFormat === 'roman' && seg.romanText ? seg.romanText : seg.text;

            return (
              <div
                key={seg.id}
                className={`p-4 transition-colors ${
                  seg.confidence === 'low' ? 'bg-amber-50/35' : 'hover:bg-slate-50/70'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    {/* Clickable timestamp for audio seek */}
                    <button
                      type="button"
                      onClick={() => handleSeek(seg.timestampSeconds)}
                      disabled={!audioUrl}
                      title={audioUrl ? `Play audio from ${seg.timestamp}` : 'Audio not loaded'}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono font-medium tabular-nums text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                    >
                      <Play className="h-2.5 w-2.5" />
                      <span>{seg.timestamp}</span>
                    </button>

                    {/* Clickable Speaker role switch */}
                    <button
                      type="button"
                      onClick={() => toggleSpeaker(seg.id)}
                      title="Click to switch Agent / Customer label"
                      className={`font-semibold px-2 py-0.5 rounded border text-xs transition-colors ${
                        isAgent
                          ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                          : 'border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      {seg.speaker}
                    </button>

                    <span className="text-slate-500">{seg.language}</span>

                    {seg.confidence === 'low' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-amber-700">
                          Low Confidence (Verify Audio)
                        </span>
                      </>
                    )}

                    {seg.isEdited && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-blue-700 font-medium">Edited</span>
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEditing(seg)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      >
                        <Edit3 className="h-3 w-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSegment(seg.id)}
                        title="Delete segment"
                        className="inline-flex items-center justify-center rounded border border-slate-200 bg-white p-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-3 space-y-3 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Timestamp (MM:SS)
                        </label>
                        <input
                          type="text"
                          value={draftTimestamp}
                          onChange={(e) => setDraftTimestamp(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-700">
                          Detected Language
                        </label>
                        <select
                          value={draftLanguage}
                          onChange={(e) => setDraftLanguage(e.target.value as DetectedLanguage)}
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                        >
                          {LANGUAGE_OPTIONS.map((lang) => (
                            <option key={lang} value={lang}>
                              {lang}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="block text-xs font-medium text-slate-700">
                          Transcribed Text (Singlish for Sinhala / English / Tamil Script)
                        </label>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={isConvertingSinglish || !draftText.trim()}
                            onClick={async () => {
                              setIsConvertingSinglish(true);
                              try {
                                const r = await fetch('/api/transliterate-singlish', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ text: draftText }),
                                });
                                const j = await r.json();
                                if (r.ok && j.singlishText) {
                                  setDraftText(j.singlishText);
                                }
                              } finally {
                                setIsConvertingSinglish(false);
                              }
                            }}
                            className="text-xs font-medium text-blue-700 hover:underline disabled:opacity-50"
                          >
                            {isConvertingSinglish ? 'Converting...' : 'Convert Sinhala to Singlish'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraftText((prev) => `${prev ? `${prev} ` : ''}[Unclear audio]`)
                            }
                            className="text-xs font-medium text-slate-600 hover:underline"
                          >
                            + Insert [Unclear audio]
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={2}
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </div>

                    {(draftLanguage.includes('Tamil') || draftRomanText) && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Roman Tamil (Optional)
                        </label>
                        <input
                          type="text"
                          value={draftRomanText}
                          onChange={(e) => setDraftRomanText(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                        />
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEditing(seg.id)}
                        className="inline-flex items-center gap-1 rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Save Correction</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <p className="text-[15px] leading-relaxed text-slate-900">{displayText}</p>
                    {tamilFormat === 'script' && seg.romanText && (
                      <p className="mt-1 text-xs text-slate-500">Roman Tamil: {seg.romanText}</p>
                    )}
                    {seg.uncertaintyNote && (
                      <p className="mt-1 text-xs text-amber-800">Note: {seg.uncertaintyNote}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
