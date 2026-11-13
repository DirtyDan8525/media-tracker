import type { Category, Entry } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { localDb } from '../db/local';
import { COUNTS_KEY } from './useEntries';

export const entriesKey = (c: Category) => ['entries', c] as const;
export const entryKey = (id: string) => ['entry', id] as const;

/** Entries whose lookup is running in this tab. A 'pending' row not in here is left over from a lookup that never finished. */
const inFlight = new Set<string>();
export const lookupRunning = {
  add: (id: string) => void inFlight.add(id),
  delete: (id: string) => void inFlight.delete(id),
  has: (id: string) => inFlight.has(id),
};

/** What the row should show: a stale 'pending' (nothing is looking it up) counts as not found, so Retry is offered. */
export function effectiveLookupState(e: Pick<Entry, 'id' | 'lookupState'>): Entry['lookupState'] {
  return e.lookupState === 'pending' && !inFlight.has(e.id) ? 'not_found' : e.lookupState;
}

async function dexie(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch { /* the on-device copy is best-effort */ }
}

/**
 * Puts `entry` into the list cache (replacing `replaceId`, a temporary row, or the same id) and the
 * entry cache. Only the query cache is touched when `persist` is false (temporary rows).
 */
export function writeEntry(qc: QueryClient, entry: Entry, opts: { replaceId?: string; persist?: boolean } = {}): void {
  const drop = opts.replaceId ?? entry.id;
  // Order doesn't matter here: the list view sorts.
  qc.setQueryData<Entry[]>(entriesKey(entry.category), (rows) =>
    rows && [...rows.filter((r) => r.id !== drop && r.id !== entry.id), entry]);
  qc.setQueryData(entryKey(entry.id), entry);
  if (opts.persist !== false) void dexie(() => localDb.entries.put(entry));
  void qc.invalidateQueries({ queryKey: COUNTS_KEY });
}

export function removeEntryFromCache(qc: QueryClient, entry: Pick<Entry, 'id' | 'category'>): void {
  qc.setQueryData<Entry[]>(entriesKey(entry.category), (rows) => rows?.filter((r) => r.id !== entry.id));
  qc.removeQueries({ queryKey: entryKey(entry.id) });
  void dexie(() => localDb.entries.delete(entry.id));
  void qc.invalidateQueries({ queryKey: COUNTS_KEY });
}

/** An optimistic local change (list + entry cache, not the device DB). Returns what it replaced, for rollback. */
export function patchLocal(qc: QueryClient, entry: Pick<Entry, 'id' | 'category'>, patch: Partial<Entry>): Entry | undefined {
  const prev = qc.getQueryData<Entry[]>(entriesKey(entry.category))?.find((r) => r.id === entry.id)
    ?? qc.getQueryData<Entry>(entryKey(entry.id));
  if (!prev) return undefined;
  const next = { ...prev, ...patch };
  qc.setQueryData<Entry[]>(entriesKey(entry.category), (rows) => rows?.map((r) => (r.id === entry.id ? next : r)));
  qc.setQueryData(entryKey(entry.id), next);
  return prev;
}

/** Put back a row that patchLocal replaced (list + entry cache). */
export function restoreLocal(qc: QueryClient, prev: Entry): void {
  qc.setQueryData<Entry[]>(entriesKey(prev.category), (rows) => rows?.map((r) => (r.id === prev.id ? prev : r)));
  qc.setQueryData(entryKey(prev.id), prev);
}
