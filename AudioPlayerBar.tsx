import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw, Trash2, Volume2 } from 'lucide-react';
import { formatDuration } from '../utils/audio';

interface AudioPlayerBarProps {
  audioUrl: string | null;
  fileName: string;
  durationSeconds: number;
  seekRequest: { seconds: number; nonce: number } | null;
  onDeleteAudio?: () => void;
  compact?: boolean;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  audioUrl,
  fileName,
  durationSeconds,
  seekRequest,
  onDeleteAudio,
  compact = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds || 0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    setDuration(durationSeconds || 0);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [audioUrl, durationSeconds]);

  useEffect(() => {
    if (!seekRequest || !audioRef.current || !audioUrl) return;
    const target = Math.max(0, seekRequest.seconds);
    audioRef.current.currentTime = target;
    setCurrentTime(target);
    audioRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }, [seekRequest, audioUrl]);

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const skip = (delta: number) => {
    if (!audioRef.current) return;
    const next = Math.max(0, Math.min(duration || 0, audioRef.current.currentTime + delta));
    audioRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  if (!audioUrl) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <div className="flex items-center gap-2 min-w-0">
          <Volume2 className="h-4 w-4 text-slate-400 shrink-0" />
          <span className="truncate">
            Audio file <span className="font-medium text-slate-800">{fileName || 'not attached'}</span> is not stored in this session (raw audio is not permanently saved by default).
          </span>
        </div>
        <span className="font-mono text-xs tabular-nums text-slate-500 shrink-0">
          Duration {formatDuration(durationSeconds)}
        </span>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${compact ? 'px-4 py-3' : 'p-4'}`}>
      <audio
        ref={audioRef}
        src={audioUrl}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => skip(-5)}
            title="Rewind 5 seconds"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-700 px-3.5 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            onClick={() => skip(5)}
            title="Forward 5 seconds"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 items-center gap-3 min-w-[200px]">
          <span className="font-mono text-xs tabular-nums text-slate-600 w-11 text-right shrink-0">
            {formatDuration(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.5}
            value={Math.min(currentTime, duration || 100)}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (audioRef.current) audioRef.current.currentTime = val;
              setCurrentTime(val);
            }}
            aria-label="Seek audio position"
            className="h-1.5 flex-1 cursor-pointer accent-blue-700"
          />
          <span className="font-mono text-xs tabular-nums text-slate-500 w-11 shrink-0">
            {formatDuration(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
            {[0.75, 1, 1.25, 1.5].map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => handleRateChange(rate)}
                className={`px-2 py-1 font-mono text-xs tabular-nums rounded transition-colors whitespace-nowrap shrink-0 ${
                  playbackRate === rate
                    ? 'bg-white text-blue-700 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          {onDeleteAudio && (
            <button
              type="button"
              onClick={onDeleteAudio}
              title="Remove uploaded audio recording from memory"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 hover:border-red-200 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete Audio</span>
            </button>
          )}
        </div>
      </div>

      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700 truncate max-w-md">{fileName}</span>
          <span aria-hidden="true">·</span>
          <span>Click any timestamp in the transcript or scorecard to jump directly to that point</span>
        </div>
      )}
    </div>
  );
};
