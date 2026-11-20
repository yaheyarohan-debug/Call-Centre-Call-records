import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileAudio, Loader2, ShieldAlert, UploadCloud, X } from 'lucide-react';
import { AppSettings, CallMetadata } from '../types/cqm';
import { extractAudioDuration, formatBytes, formatDuration, validateAudioFile } from '../utils/audio';
import { AudioPlayerBar } from './AudioPlayerBar';

export interface UploadAnalysisPayload {
  file: File;
  objectUrl: string;
  metadata: CallMetadata;
}

interface UploadRecordingViewProps {
  settings: AppSettings;
  onAnalysisComplete: (payload: {
    file: File;
    objectUrl: string;
    metadata: CallMetadata;
    transcription: any;
    evaluation: any | null;
  }) => Promise<void>;
}

type ProcessingStage = 'idle' | 'uploading' | 'transcribing' | 'evaluating' | 'error';

export const UploadRecordingView: React.FC<UploadRecordingViewProps> = ({
  settings,
  onAnalysisComplete,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number>(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [authorizedConfirmed, setAuthorizedConfirmed] = useState(false);

  const [agentName, setAgentName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [callReference, setCallReference] = useState('');
  const [callDate, setCallDate] = useState(new Date().toISOString().slice(0, 10));
  const [evaluatorName, setEvaluatorName] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');

  const [stage, setStage] = useState<ProcessingStage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFileSelection = async (file: File) => {
    setValidationError(null);
    setErrorMessage(null);
    const check = validateAudioFile(file);
    if (!check.valid) {
      setValidationError(check.error || 'Invalid audio file.');
      return;
    }

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    const url = URL.createObjectURL(file);
    const dur = await extractAudioDuration(url);

    setSelectedFile(file);
    setObjectUrl(url);
    setDurationSeconds(dur);
    if (!callReference) {
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 24);
      setCallReference(`FNOL-${baseName}`);
    }
  };

  const clearSelectedFile = () => {
    if (stage === 'uploading' || stage === 'transcribing' || stage === 'evaluating') {
      return;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    setSelectedFile(null);
    setObjectUrl(null);
    setDurationSeconds(0);
    setValidationError(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCancelProcessing = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStage('idle');
    setUploadProgress(0);
    setStatusMessage('');
    setErrorMessage('Processing cancelled by user.');
  };

  const uploadAndTranscribeWithProgress = (
    file: File,
    configPayload: Record<string, unknown>
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('config', JSON.stringify(configPayload));

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(pct);
          if (pct >= 100) {
            setStage('transcribing');
            setStatusMessage(
              'Audio uploaded. Running multilingual transcription (Singlish, English, Tamil) & speaker diarization...'
            );
          }
        }
      };

      xhr.onload = () => {
        xhrRef.current = null;
        try {
          const json = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || `Transcription failed (HTTP ${xhr.status}).`));
          }
        } catch {
          reject(new Error(`Invalid server response during transcription (HTTP ${xhr.status}).`));
        }
      };

      xhr.onerror = () => {
        xhrRef.current = null;
        reject(new Error('Network error occurred while uploading the audio recording.'));
      };

      xhr.onabort = () => {
        xhrRef.current = null;
        reject(new Error('CANCELLED'));
      };

      xhr.open('POST', '/api/transcribe');
      xhr.send(formData);
    });
  };

  const runProcessing = async (mode: 'transcribe_only' | 'full_analysis') => {
    setErrorMessage(null);

    if (!selectedFile || !objectUrl) {
      setErrorMessage('Please select a valid audio recording before starting.');
      return;
    }
    if (!authorizedConfirmed) {
      setErrorMessage('Please confirm that you have proper authorization to process this call recording.');
      return;
    }
    if (!agentName.trim() || !callReference.trim()) {
      setErrorMessage('Please enter both Agent Name and Call Reference Number.');
      return;
    }

    const metadata: CallMetadata = {
      agentName: agentName.trim(),
      agentId: agentId.trim() || 'N/A',
      callReference: callReference.trim(),
      callDate: callDate || new Date().toISOString().slice(0, 10),
      callType: 'FNOL',
      evaluatorName: evaluatorName.trim() || 'Quality Checker',
      additionalNotes: additionalNotes.trim(),
      fileName: selectedFile.name,
      fileSizeBytes: selectedFile.size,
      durationSeconds,
      mimeType: selectedFile.type || 'audio/wav',
    };

    try {
      setStage('uploading');
      setUploadProgress(0);
      setStatusMessage('Uploading audio recording securely to backend...');

      const transcription = await uploadAndTranscribeWithProgress(selectedFile, {
        preferDedicatedTranscriptionFirst: settings.languageHandling.preferDedicatedTranscriptionFirst,
        enableSinhala: settings.languageHandling.enableSinhala,
        enableEnglish: settings.languageHandling.enableEnglish,
        enableTamil: settings.languageHandling.enableTamil,
        tamilDisplay: settings.transcriptionPrefs.tamilDisplay,
      });

      if (mode === 'transcribe_only') {
        await onAnalysisComplete({
          file: selectedFile,
          objectUrl,
          metadata,
          transcription,
          evaluation: null,
        });
        return;
      }

      setStage('evaluating');
      setStatusMessage(
        'Evaluating 11 CQM scorecard parameters and FNOL QA rules based on transcript evidence...'
      );

      const controller = new AbortController();
      abortRef.current = controller;

      const evalResp = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          transcriptSegments: transcription.segments,
          metadata,
          scorecardConfig: settings.scorecard,
          qaRules: settings.qaRules,
          thresholds: settings.thresholds,
          durationSeconds,
        }),
      });

      const evalJson = await evalResp.json();
      abortRef.current = null;

      if (!evalResp.ok) {
        throw new Error(evalJson.error || `CQM Evaluation failed (HTTP ${evalResp.status}).`);
      }

      await onAnalysisComplete({
        file: selectedFile,
        objectUrl,
        metadata,
        transcription,
        evaluation: evalJson,
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err.message === 'CANCELLED' || err.name === 'AbortError')) {
        return;
      }
      setStage('error');
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred during processing.');
    }
  };

  const handleAnalyseCall = async (e: React.FormEvent) => {
    e.preventDefault();
    await runProcessing('full_analysis');
  };

  const isProcessing = stage === 'uploading' || stage === 'transcribing' || stage === 'evaluating';

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Upload FNOL Call Recording
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload WAV or standard audio recordings, verify playback, enter call metadata, and run AI transcription &amp; CQM evaluation.
        </p>
      </div>

      {/* Security & Authorization Notice */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700 shrink-0" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-950">
              Authorization &amp; Data Handling Notice
            </div>
            <p className="text-xs leading-relaxed text-amber-900">
              Ensure you hold proper authorization before uploading insurance customer recordings. Do not use real company recordings for testing without approval. Audio is processed ephemerally through the secure backend and is <strong>not permanently stored</strong> by default. Evaluation records saved in your browser are local only and may be lost if browser site data is cleared.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleAnalyseCall} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: File Dropzone & Pre-processing Player */}
        <div className="space-y-5 lg:col-span-6">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">1. Audio Recording File</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Supports WAV (recommended), MP3, M4A, OGG, and WEBM up to 50 MB.
            </p>

            {!selectedFile ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileSelection(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                }}
                className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  isDragging
                    ? 'border-blue-600 bg-blue-50/70'
                    : 'border-slate-300 bg-slate-50/60 hover:border-blue-500 hover:bg-slate-50'
                }`}
              >
                <UploadCloud className="h-10 w-10 text-blue-700" />
                <div className="mt-3 text-sm font-medium text-slate-900">
                  Drag and drop call recording here, or click to browse
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  WAV · MP3 · M4A · OGG · WEBM (Max 50 MB)
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.aac,.flac"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelection(file);
                  }}
                />
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-100 text-blue-700 shrink-0">
                      <FileAudio className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {selectedFile.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums text-slate-600">
                        <span>{formatBytes(selectedFile.size)}</span>
                        <span aria-hidden="true">·</span>
                        <span>Duration {formatDuration(durationSeconds)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{selectedFile.type || 'audio/wav'}</span>
                      </div>
                    </div>
                  </div>

                  {!isProcessing && (
                    <button
                      type="button"
                      onClick={clearSelectedFile}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>

                {/* Audio playback before processing */}
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-600">
                    Pre-Processing Audio Playback Verification
                  </div>
                  <AudioPlayerBar
                    audioUrl={objectUrl}
                    fileName={selectedFile.name}
                    durationSeconds={durationSeconds}
                    seekRequest={null}
                    compact
                  />
                </div>
              </div>
            )}

            {validationError && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}
          </div>

          {/* Authorization Checkbox */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={authorizedConfirmed}
                disabled={isProcessing}
                onChange={(e) => setAuthorizedConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="text-xs leading-relaxed text-slate-700">
                I confirm that I am authorized to review and evaluate this FNOL call recording for Quality Monitoring, and understand that AI analysis will only start when I click <strong>Analyse Call</strong>.
              </span>
            </label>
          </div>
        </div>

        {/* Right Column: Call Metadata Form & Processing Controls */}
        <div className="space-y-5 lg:col-span-6">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">2. Call Metadata Details</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Used for evaluation records, CQM evaluation context, and Excel reports.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="agentName" className="block text-xs font-medium text-slate-700">
                  Agent Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="agentName"
                  type="text"
                  required
                  disabled={isProcessing}
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g. Kasun Perera"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-50"
                />
              </div>

              <div>
                <label htmlFor="agentId" className="block text-xs font-medium text-slate-700">
                  Agent ID
                </label>
                <input
                  id="agentId"
                  type="text"
                  disabled={isProcessing}
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="e.g. CC-1042"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-50"
                />
              </div>

              <div>
                <label htmlFor="callReference" className="block text-xs font-medium text-slate-700">
                  Call Reference Number <span className="text-red-600">*</span>
                </label>
                <input
                  id="callReference"
                  type="text"
                  required
                  disabled={isProcessing}
                  value={callReference}
                  onChange={(e) => setCallReference(e.target.value)}
                  placeholder="e.g. FNOL-2026-88412"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-50"
                />
              </div>

              <div>
                <label htmlFor="callDate" className="block text-xs font-medium text-slate-700">
                  Call Date
                </label>
                <input
                  id="callDate"
                  type="date"
                  disabled={isProcessing}
                  value={callDate}
                  onChange={(e) => setCallDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-50"
                />
              </div>

              <div>
                <label htmlFor="callType" className="block text-xs font-medium text-slate-700">
                  Call Type
                </label>
                <input
                  id="callType"
                  type="text"
                  readOnly
                  value="FNOL (First Notice of Loss)"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </div>

              <div>
                <label htmlFor="evaluatorName" className="block text-xs font-medium text-slate-700">
                  Evaluator Name
                </label>
                <input
                  id="evaluatorName"
                  type="text"
                  disabled={isProcessing}
                  value={evaluatorName}
                  onChange={(e) => setEvaluatorName(e.target.value)}
                  placeholder="Quality Checker name"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-50"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="additionalNotes" className="block text-xs font-medium text-slate-700">
                  Additional Notes
                </label>
                <textarea
                  id="additionalNotes"
                  rows={3}
                  disabled={isProcessing}
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  placeholder="Optional context (e.g., late intimation dispute, towing request, MCC ticket reference)"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-50"
                />
              </div>
            </div>
          </div>

          {/* Processing Status & Action Buttons */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            {isProcessing && (
              <div className="space-y-2.5 rounded-md border border-blue-200 bg-blue-50/70 p-4">
                <div className="flex items-center justify-between text-xs font-medium text-blue-900">
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-700" />
                    <span>
                      {stage === 'uploading'
                        ? 'Uploading Recording'
                        : stage === 'transcribing'
                        ? 'Transcribing & Diarizing Audio'
                        : 'Evaluating FNOL CQM Scorecard'}
                    </span>
                  </span>
                  {stage === 'uploading' && (
                    <span className="font-mono tabular-nums">{uploadProgress}%</span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full bg-blue-700 transition-all duration-300"
                    style={{
                      width:
                        stage === 'uploading'
                          ? `${uploadProgress}%`
                          : stage === 'transcribing'
                          ? '68%'
                          : '92%',
                    }}
                  />
                </div>
                <p className="text-xs text-blue-800">{statusMessage}</p>
              </div>
            )}

            {errorMessage && (
              <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                <div>
                  <div className="font-semibold">Processing Notice</div>
                  <div className="mt-0.5">{errorMessage}</div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              {selectedFile && !isProcessing && (
                <button
                  type="button"
                  onClick={clearSelectedFile}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Cancel Selection
                </button>
              )}

              {isProcessing ? (
                <button
                  type="button"
                  onClick={handleCancelProcessing}
                  className="rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0"
                >
                  Cancel Processing
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!selectedFile || !authorizedConfirmed}
                    onClick={() => runProcessing('transcribe_only')}
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 whitespace-nowrap shrink-0"
                  >
                    <span>Transcribe Only</span>
                  </button>
                  <button
                    type="submit"
                    disabled={!selectedFile || !authorizedConfirmed}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 whitespace-nowrap shrink-0"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Analyse Call</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
