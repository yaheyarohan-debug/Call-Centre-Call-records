import { DEFAULT_SETTINGS } from '../constants/defaultSettings';
import { AppSettings, CallEvaluationRecord } from '../types/cqm';

const DB_NAME = 'fnol_cqm_local_db';
const DB_VERSION = 1;
const STORE_EVALUATIONS = 'evaluations';
const STORE_AUDIO = 'audio_blobs';
const SETTINGS_KEY = 'fnol_cqm_settings_v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_EVALUATIONS)) {
        const evalStore = db.createObjectStore(STORE_EVALUATIONS, { keyPath: 'id' });
        evalStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open local IndexedDB storage.'));
  });
}

export async function listEvaluations(): Promise<CallEvaluationRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVALUATIONS, 'readonly');
    const store = tx.objectStore(STORE_EVALUATIONS);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as CallEvaluationRecord[]) || [];
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      resolve(items);
    };
    req.onerror = () => reject(req.error || new Error('Failed to load evaluation history.'));
  });
}

export async function saveEvaluation(record: CallEvaluationRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVALUATIONS, 'readwrite');
    tx.objectStore(STORE_EVALUATIONS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save evaluation record.'));
  });
}

export async function deleteEvaluations(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_EVALUATIONS, STORE_AUDIO], 'readwrite');
    const evalStore = tx.objectStore(STORE_EVALUATIONS);
    const audioStore = tx.objectStore(STORE_AUDIO);
    for (const id of ids) {
      evalStore.delete(id);
      audioStore.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete selected records.'));
  });
}

export async function saveAudioBlob(id: string, blob: Blob, fileName: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).put({ id, blob, fileName, savedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to store temporary audio recording.'));
  });
}

export async function getAudioBlob(id: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readonly');
    const req = tx.objectStore(STORE_AUDIO).get(id);
    req.onsuccess = () => {
      const result = req.result as { blob?: Blob } | undefined;
      resolve(result?.blob ?? null);
    };
    req.onerror = () => reject(req.error || new Error('Failed to retrieve stored audio.'));
  });
}

export async function deleteAudioBlob(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete audio recording.'));
  });
}

export async function clearAllLocalData(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_EVALUATIONS, STORE_AUDIO], 'readwrite');
    tx.objectStore(STORE_EVALUATIONS).clear();
    tx.objectStore(STORE_AUDIO).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear local IndexedDB data.'));
  });
}

export async function enforceRetentionPolicy(maxHistoryDays: number): Promise<number> {
  if (!maxHistoryDays || maxHistoryDays <= 0) return 0;
  const records = await listEvaluations();
  const cutoff = Date.now() - maxHistoryDays * 24 * 60 * 60 * 1000;
  const expiredIds = records
    .filter((r) => new Date(r.createdAt).getTime() < cutoff)
    .map((r) => r.id);
  if (expiredIds.length > 0) {
    await deleteEvaluations(expiredIds);
  }
  return expiredIds.length;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      scorecard: Array.isArray(parsed.scorecard) && parsed.scorecard.length === 11 ? parsed.scorecard : DEFAULT_SETTINGS.scorecard,
      qaRules: Array.isArray(parsed.qaRules) && parsed.qaRules.length > 0 ? parsed.qaRules : DEFAULT_SETTINGS.qaRules,
      transcriptionPrefs: { ...DEFAULT_SETTINGS.transcriptionPrefs, ...(parsed.transcriptionPrefs || {}) },
      languageHandling: { ...DEFAULT_SETTINGS.languageHandling, ...(parsed.languageHandling || {}) },
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(parsed.thresholds || {}) },
      dataRetention: { ...DEFAULT_SETTINGS.dataRetention, ...(parsed.dataRetention || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function resetSettingsToDefault(): AppSettings {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
  return DEFAULT_SETTINGS;
}
