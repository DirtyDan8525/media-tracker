import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, SourceId } from '@media-tracker/shared';
import { api } from '../../api/client';
import '../../design/media.css';

/** Only one preview plays at a time: the one playing registers its stop function here. */
let stopCurrent: (() => void) | null = null;

export const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type PreviewEntry = { category: Category; title: string; creator: string; source: SourceId | null; sourceId: string | null };

/**
 * "▶ Play preview" on a song or album title page (Phase 7, board 7): a 30-second clip from Deezer, fetched fresh
 * (the clip urls are signed and expire) through /api/preview. Nothing shows until a clip is found. Playing opens an
 * inline mini player (play/pause, elapsed / length, progress bar). Leaving the page stops it.
 */
export function PlayPreview({ entry }: { entry: PreviewEntry }) {
  const isMusic = entry.category === 'songs' || entry.category === 'albums';
  const deezerId = entry.source === 'deezer' && entry.sourceId ? entry.sourceId : '';
  const { data, refetch } = useQuery({
    queryKey: ['preview', entry.category, entry.title, entry.creator, deezerId],
    queryFn: () => {
      const kind = entry.category === 'albums' ? 'album' : 'track';
      const id = deezerId ? `&id=${encodeURIComponent(deezerId)}` : '';
      return api.get<{ url: string | null }>(`/api/preview?kind=${kind}&title=${encodeURIComponent(entry.title)}&artist=${encodeURIComponent(entry.creator)}${id}`);
    },
    enabled: isMusic && entry.title.trim() !== '',
    staleTime: 2 * 60 * 1000, // the clip url is signed and expires
    gcTime: 3 * 60 * 1000,
    retry: false,
  });
  // The element is kept after React detaches the ref on unmount, so leaving the page can still stop it.
  const audio = useRef<HTMLAudioElement | null>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(30);

  const stopMe = useCallback(() => {
    audio.current?.pause();
    setPlaying(false);
    setStarted(false);
    setTime(0);
  }, []);
  useEffect(() => () => {
    audio.current?.pause();
    if (stopCurrent === stopMe) stopCurrent = null;
  }, [stopMe]);

  const url = data?.url ?? null;
  if (!isMusic || !url) return null;

  const start = () => {
    if (stopCurrent && stopCurrent !== stopMe) stopCurrent();
    stopCurrent = stopMe;
    // An expired or broken clip: stop and fetch a fresh url for the next try.
    void audio.current?.play()?.catch(() => { stopMe(); void refetch(); });
  };
  const play = () => { setStarted(true); start(); };
  const toggle = () => { if (audio.current?.paused) start(); else audio.current?.pause(); };

  return (
    <div className="preview">
      {!started && (
        <button type="button" className="btn btn--secondary detail__watch" onClick={play}>▶ Play preview</button>
      )}
      {started && (
        <div className="preview__player">
          <button type="button" className="preview__toggle" aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={toggle}>
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="preview__time">{fmtClock(time)} / {fmtClock(length)}</span>
          <div className="preview__bar" role="progressbar" aria-label="Preview progress" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(time)}>
            <i style={{ width: `${Math.min(100, length > 0 ? (time / length) * 100 : 0)}%` }} />
          </div>
        </div>
      )}
      <audio
        ref={(el) => { if (el) audio.current = el; }} src={url} preload="none"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) setLength(e.currentTarget.duration); }}
        onEnded={stopMe}
        onError={() => { stopMe(); void refetch(); }}
      />
    </div>
  );
}
