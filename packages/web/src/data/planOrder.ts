import type { Category, Entry } from '@media-tracker/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { api } from '../api/client';
import { localDb } from '../db/local';
import { entriesKey, entryKey } from './entryCache';

type Placed = Map<string, number | null>;

/**
 * Shows a new Plan to watch order at once: planned title `ids[i]` gets place i + 1 in the list cache,
 * the entry cache and the on-device copy. Returns each changed title's old place, for rollback.
 */
export function applyPlanOrder(qc: QueryClient, category: Category, ids: string[]): Placed {
  const place = new Map(ids.map((id, i) => [id, i + 1]));
  const before: Placed = new Map();
  const changed: Entry[] = [];
  qc.setQueryData<Entry[]>(entriesKey(category), (rows) => rows?.map((e) => {
    const n = place.get(e.id);
    if (n === undefined) return e;
    before.set(e.id, e.planOrder ?? null);
    if (e.planOrder === n) return e;
    const next = { ...e, planOrder: n };
    changed.push(next);
    return next;
  }));
  for (const e of changed) qc.setQueryData<Entry>(entryKey(e.id), (cur) => (cur ? { ...cur, planOrder: e.planOrder } : cur));
  if (changed.length) void localDb.entries.bulkPut(changed).catch(() => undefined);
  return before;
}

function restorePlanOrder(qc: QueryClient, category: Category, before: Placed): void {
  const changed: Entry[] = [];
  qc.setQueryData<Entry[]>(entriesKey(category), (rows) => rows?.map((e) => {
    if (!before.has(e.id)) return e;
    const next = { ...e, planOrder: before.get(e.id) ?? null };
    changed.push(next);
    return next;
  }));
  for (const e of changed) qc.setQueryData<Entry>(entryKey(e.id), (cur) => (cur ? { ...cur, planOrder: e.planOrder } : cur));
  if (changed.length) void localDb.entries.bulkPut(changed).catch(() => undefined);
}

/**
 * Saves a list's Plan to watch order (PUT /api/entries/plan-order). The new order shows at once. Saves go one
 * at a time (the last order wins), and when one fails the order from before the unsaved moves comes back
 * and `onFail` runs.
 */
export function useSavePlanOrder(category: Category, onFail: () => void): (ids: string[]) => void {
  const qc = useQueryClient();
  const state = useRef<{ running: boolean; latest: string[] | null; before: Placed | null }>({ running: false, latest: null, before: null });
  const fail = useRef(onFail);
  fail.current = onFail;

  return useCallback((ids: string[]) => {
    const s = state.current;
    const before = applyPlanOrder(qc, category, ids);
    if (s.before === null) s.before = before;
    else for (const [id, n] of before) if (!s.before.has(id)) s.before.set(id, n);
    s.latest = ids;
    if (s.running) return;
    s.running = true;
    void (async () => {
      while (s.latest) {
        const next = s.latest;
        s.latest = null;
        try {
          await api.put<void>('/api/entries/plan-order', { category, ids: next });
          if (!s.latest) s.before = null;
        } catch {
          if (s.before) restorePlanOrder(qc, category, s.before);
          s.before = null;
          s.latest = null;
          fail.current();
        }
      }
      s.running = false;
    })();
  }, [qc, category]);
}
