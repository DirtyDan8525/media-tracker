import type { Entry } from '@media-tracker/shared';

/**
 * "Rate on complete" (Phase 7, board 1): whoever sets a title to Completed announces it here, and one host
 * (RateOnCompleteHost, mounted once under the session gate) opens the rating sheet. Only unrated titles are announced.
 */
export const COMPLETED = 'Completed';

type Listener = (entry: Entry) => void;
const listeners = new Set<Listener>();

export function onCompleted(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Announces a title that was just set to Completed. Does nothing when it already has a rating. */
export function announceCompleted(entry: Entry): void {
  if (entry.rating !== null) return;
  for (const fn of [...listeners]) fn(entry);
}
