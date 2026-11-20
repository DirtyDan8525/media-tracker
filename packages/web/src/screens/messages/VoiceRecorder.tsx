import { VOICE_MAX_BYTES, VOICE_MAX_MS } from '@media-tracker/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { mmss } from './format';

/** Tried in order: Opus in WebM (Chrome, Android, Firefox), AAC in MP4 (iPhone Safari), Opus in Ogg. */
export const VOICE_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'] as const;
/** Speech is clear at this rate; 2 minutes stays near 480 KB (the server's limit is 1 MB). */
export const VOICE_BITS_PER_SECOND = 32_000;

/** The first format this browser records, or null when it cannot record audio at all. */
export function pickVoiceMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  const test = typeof MediaRecorder.isTypeSupported === 'function' ? MediaRecorder.isTypeSupported.bind(MediaRecorder) : () => false;
  return VOICE_MIME_CANDIDATES.find((t) => test(t)) ?? null;
}

type State = { kind: 'starting' } | { kind: 'recording' } | { kind: 'error'; text: string };

/**
 * The composer's recording strip: asks for the microphone only now, records (timer, Cancel, Send), stops by itself at
 * 2 minutes and then waits for Send. `onSend` gets the recording and its length; `onClose` ends the strip.
 */
export function VoiceRecorder({ onSend, onClose, sending }: { onSend: (blob: Blob, durationMs: number) => void; onClose: () => void; sending: boolean }) {
  const [state, setState] = useState<State>({ kind: 'starting' });
  const [elapsed, setElapsed] = useState(0);
  const [full, setFull] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const stoppedAt = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const sendAfterStop = useRef(false);
  const cancelled = useRef(false);
  const sendRef = useRef<HTMLButtonElement>(null);

  const release = () => {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  const finish = () => {
    const ms = Math.min((stoppedAt.current ?? Date.now()) - started.current, VOICE_MAX_MS);
    const type = (rec.current?.mimeType || chunks.current[0]?.type || 'audio/webm').split(';')[0]!;
    const blob = new Blob(chunks.current, { type });
    if (blob.size > VOICE_MAX_BYTES) { setState({ kind: 'error', text: 'That voice memo is too big to send. Try a shorter one.' }); return; }
    if (blob.size === 0 || ms < 300) { setState({ kind: 'error', text: 'Nothing was recorded. Try again.' }); return; }
    onSend(blob, Math.max(ms, 1));
  };

  useEffect(() => {
    const mime = pickVoiceMime();
    if (!mime) {
      setState({ kind: 'error', text: "This browser can't record voice memos." });
      return;
    }
    let alive = true;
    void (async () => {
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        if (!alive) return;
        const name = (e as { name?: string })?.name;
        setState({ kind: 'error', text: name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is blocked. Allow it for this site in your browser settings, then try again.'
          : name === 'NotFoundError' ? 'No microphone was found.' : "Couldn't start the microphone. Try again." });
        return;
      }
      if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
      stream.current = s;
      let r: MediaRecorder;
      try {
        r = new MediaRecorder(s, { mimeType: mime, audioBitsPerSecond: VOICE_BITS_PER_SECOND });
      } catch {
        release();
        setState({ kind: 'error', text: "This browser can't record voice memos." });
        return;
      }
      rec.current = r;
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.current.push(e.data); };
      r.onstop = () => {
        release();
        if (cancelled.current) return;
        if (sendAfterStop.current) finish();
      };
      r.start(1000);
      started.current = Date.now();
      setState({ kind: 'recording' });
      timer.current = window.setInterval(() => {
        const ms = Date.now() - started.current;
        setElapsed(Math.min(ms, VOICE_MAX_MS));
        if (ms >= VOICE_MAX_MS && r.state === 'recording') {
          stoppedAt.current = started.current + VOICE_MAX_MS;
          setFull(true);
          r.stop();
        }
      }, 250);
    })();
    return () => {
      alive = false;
      cancelled.current = true;
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
      release();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (full) sendRef.current?.focus(); }, [full]);

  function cancel() {
    cancelled.current = true;
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    release();
    onClose();
  }
  function send() {
    const r = rec.current;
    if (!r) return;
    if (r.state !== 'inactive') {
      stoppedAt.current = Date.now();
      sendAfterStop.current = true;
      r.stop();
    } else {
      finish();
    }
  }

  if (state.kind === 'error') {
    return (
      <div className="recorder recorder--error" role="group" aria-label="Voice memo">
        <p className="recorder__error" role="alert">{state.text}</p>
        <IconButton label="Close" icon="close" look="plain" onClick={onClose} />
      </div>
    );
  }
  return (
    <div className="recorder" role="group" aria-label="Recording a voice memo">
      <IconButton label="Cancel recording" icon="close" look="plain" onClick={cancel} />
      <span className={`recorder__dot${state.kind === 'recording' && !full ? ' is-live' : ''}`} aria-hidden="true" />
      <span className="recorder__time" role="timer" aria-live="off">
        {state.kind === 'starting' ? 'Starting…' : `${mmss(elapsed)} / ${mmss(VOICE_MAX_MS)}`}
      </span>
      {full && <span className="recorder__note" role="status">2-minute limit reached</span>}
      <button ref={sendRef} type="button" className="icon-btn icon-btn--outlined composer__send" aria-label="Send voice memo" title="Send voice memo"
        disabled={state.kind !== 'recording' || sending} onClick={send}>
        <Icon name="send" size={22} />
      </button>
    </div>
  );
}
