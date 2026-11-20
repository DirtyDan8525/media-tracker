import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { messageMediaUrl } from '../../data/messages';
import { Icon } from '../../design/components/Icon';
import { mmss } from './format';

/**
 * A voice memo bubble: play/pause, a slider you can drag or tap (arrow keys move 5 s), elapsed / total time, and a speed
 * toggle (1x, 1.5x, 2x). Only one memo plays at a time. The place you stopped at is kept on this device (resumes after the
 * app is closed) and forgotten once the memo plays to the end.
 */

/** localStorage key: { [messageId]: { t: seconds, at: when saved } }, at most POSITIONS_MAX entries (oldest dropped). */
export const POSITIONS_KEY = 'mt-voice-positions';
export const POSITIONS_MAX = 200;
const SAVE_EVERY_MS = 2_000;
const STEP_S = 5;
const SPEEDS = [1, 1.5, 2] as const;

type Positions = Record<string, { t: number; at: number }>;

function readPositions(): Positions {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Positions) : {};
  } catch {
    return {};
  }
}
function writePositions(p: Positions): void {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(p));
  } catch {
    // storage full or blocked: resuming is a nicety
  }
}
export function savedPosition(id: string): number {
  const t = readPositions()[id]?.t;
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : 0;
}
export function savePosition(id: string, t: number): void {
  const p = readPositions();
  p[id] = { t, at: Date.now() };
  const ids = Object.keys(p);
  if (ids.length > POSITIONS_MAX) {
    ids.sort((a, b) => p[a]!.at - p[b]!.at);
    for (const old of ids.slice(0, ids.length - POSITIONS_MAX)) delete p[old];
  }
  writePositions(p);
}
export function clearPosition(id: string): void {
  const p = readPositions();
  if (!(id in p)) return;
  delete p[id];
  writePositions(p);
}

/** The one memo playing now: starting another pauses it. */
let playing: HTMLAudioElement | null = null;

export function VoicePlayer({ id, durationMs, from }: { id: string; durationMs: number; from: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [pos, setPos] = useState(() => savedPosition(id));
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const lastSave = useRef(0);
  const total = Math.max(durationMs / 1000, 0.1);
  const sliderId = useId();

  const persist = (t: number) => {
    lastSave.current = Date.now();
    if (t > 0 && t < total - 0.25) savePosition(id, t);
  };

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onPlay = () => {
      if (playing && playing !== el) playing.pause();
      playing = el;
      setPlaying(true);
    };
    const onPause = () => { setPlaying(false); persist(el.currentTime); if (playing === el) playing = null; };
    const onTime = () => {
      setPos(el.currentTime);
      if (Date.now() - lastSave.current >= SAVE_EVERY_MS) persist(el.currentTime);
    };
    const onEnded = () => { setPlaying(false); setPos(0); clearPosition(id); if (playing === el) playing = null; };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnded);
    // Leaving the page (or the app going to the background) keeps the place too.
    const onHide = () => { if (!el.paused) persist(el.currentTime); };
    const onVis = () => { if (document.visibilityState === 'hidden') onHide(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnded);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
      if (!el.paused) { persist(el.currentTime); el.pause(); }
      if (playing === el) playing = null;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) { el.pause(); return; }
    // Resume where the slider is (a saved place, or where it was dragged to).
    if (Math.abs(el.currentTime - pos) > 0.25) el.currentTime = pos;
    el.playbackRate = speed;
    void el.play()?.catch(() => setPlaying(false));
  }
  function seek(t: number) {
    const v = Math.min(Math.max(t, 0), total);
    setPos(v);
    const el = audio.current;
    if (el) el.currentTime = v;
    persist(v);
  }
  function nextSpeed() {
    const s = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(s);
    if (audio.current) audio.current.playbackRate = s;
  }

  return (
    <div className="voice" data-no-gesture="">
      {/* preload none: nothing is downloaded until Play (the length comes with the message). */}
      <audio ref={audio} src={messageMediaUrl(id)} preload="none" />
      <button type="button" className="voice__play" aria-label={`${isPlaying ? 'Pause' : 'Play'} voice memo from ${from}`} onClick={toggle}>
        <Icon name={isPlaying ? 'pause' : 'play'} size={20} />
      </button>
      <div className="voice__track">
        <label className="sr-only" htmlFor={sliderId}>Position in voice memo from {from}</label>
        <input id={sliderId} className="voice__slider" type="range" min={0} max={total} step={0.1} value={Math.min(pos, total)}
          aria-valuetext={`${mmss(pos * 1000)} of ${mmss(durationMs)}`}
          onChange={(e) => seek(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); seek(pos + STEP_S); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); seek(pos - STEP_S); }
          }}
          style={{ '--voice-pct': `${(Math.min(pos, total) / total) * 100}%` } as CSSProperties} />
        <span className="voice__time" aria-hidden="true">{mmss(pos * 1000)} / {mmss(durationMs)}</span>
      </div>
      <button type="button" className="voice__speed" aria-label={`Playback speed ${speed}x. Change speed`} onClick={nextSpeed}>{speed}x</button>
    </div>
  );
}
