import { clampProgress, showsProgress, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SAVE_FAILED, saveEntryChange } from '../../data/entryMutations';
import { useToast } from '../../design/components/Toast';

/** How long taps gather before one save is sent. */
export const PROGRESS_DEBOUNCE_MS = 350;

export const progressText = (progress: number, total: number | null | undefined) =>
  total != null ? `${progress} / ${total}` : String(progress);

/**
 * The count shown while taps are being gathered and saved. Taps show at once; they are debounced
 * into one PATCH carrying the latest count, and a second save never starts before the first ends
 * (so none is lost or reordered). A failed save puts the last saved count back and toasts.
 */
export function useProgress(entry: Entry) {
  const qc = useQueryClient();
  const toast = useToast();
  const total = entry.progressTotal ?? null;
  const [shown, setShown] = useState(entry.progress ?? 0);
  const shownRef = useRef(shown);
  const savedRef = useRef(entry.progress ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const latest = useRef(entry);
  latest.current = entry;
  const failMsg = useRef(toast.show);
  failMsg.current = toast.show;

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current || shownRef.current === savedRef.current) return;
    inFlight.current = true;
    const sending = shownRef.current;
    const saved = await saveEntryChange(qc, latest.current, { progress: sending });
    inFlight.current = false;
    if (saved) {
      savedRef.current = sending;
    } else {
      // Back to the last saved count, dropping any taps made meanwhile.
      shownRef.current = savedRef.current;
      setShown(savedRef.current);
      failMsg.current(SAVE_FAILED);
      return;
    }
    if (shownRef.current !== savedRef.current) void flush();
  }, [qc]);

  // Follow outside changes (a re-fetch, another tab) while nothing of ours is pending.
  useEffect(() => {
    if (timer.current || inFlight.current) return;
    const v = entry.progress ?? 0;
    savedRef.current = v;
    shownRef.current = v;
    setShown(v);
  }, [entry.progress]);

  // Leaving the screen sends what is still waiting.
  useEffect(() => () => { void flush(); }, [flush]);

  const bump = (delta: number) => {
    const next = clampProgress(shownRef.current + delta, latest.current.progressTotal);
    if (next === shownRef.current) return;
    shownRef.current = next;
    setShown(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), PROGRESS_DEBOUNCE_MS);
  };
  return { shown, total, bump };
}

/** "7 / 24" with − and + (44px targets), and "Finished? Mark as Completed" at the total. Renders nothing off the in-progress statuses. */
export function ProgressControl({ entry, className = '' }: { entry: Entry; className?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { shown, total, bump } = useProgress(entry);
  if (!showsProgress(entry)) return null;
  const done = total !== null && shown >= total;
  return (
    <div className={`progress ${className}`.trim()}>
      <div className="progress__row">
        <button type="button" className="progress__btn" aria-label={`Decrease progress for ${entry.title}`}
          disabled={shown <= 0} onClick={() => bump(-1)}>−</button>
        <span className="progress__value" aria-label={`Progress for ${entry.title}: ${total !== null ? `${shown} of ${total}` : shown}`}>
          {progressText(shown, total)}
        </span>
        <button type="button" className="progress__btn" aria-label={`Increase progress for ${entry.title}`}
          disabled={done} onClick={() => bump(1)}>+</button>
      </div>
      {done && (
        <p className="progress__done">
          <span>Finished?</span>{' '}
          <button type="button" className="link-btn progress__finish" aria-label={`Mark ${entry.title} as Completed`}
            onClick={() => void saveEntryChange(qc, entry, { status: 'Completed' }, () => toast.show(SAVE_FAILED))}>
            Mark as Completed
          </button>
        </p>
      )}
    </div>
  );
}
