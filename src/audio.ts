const ALLOWED_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.aac', '.flac'];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function validateAudioFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }
  if (file.size === 0) {
    return { valid: false, error: 'The selected audio file is empty (0 bytes).' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File exceeds the 50 MB maximum upload size.' };
  }
  const lower = file.name.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  const hasAudioMime = file.type.startsWith('audio/');
  if (!hasValidExt && !hasAudioMime) {
    return {
      valid: false,
      error: `Unsupported file format (${file.name}). Please upload a WAV, MP3, M4A, OGG, or WEBM recording.`,
    };
  }
  return { valid: true };
}

export function extractAudioDuration(objectUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
    };
    audio.onloadedmetadata = () => {
      const dur = Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0;
      cleanup();
      resolve(dur);
    };
    audio.onerror = () => {
      cleanup();
      resolve(0);
    };
    audio.src = objectUrl;
  });
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds || 0));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}
