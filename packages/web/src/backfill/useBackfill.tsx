import type { Category, Entry, LookupInfo } from '@media-tracker/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { writeEntry } from '../data/entryCache';
import { searchOnDevice } from '../lookup/device';
import { lookupDetails } from '../lookup/details';
import type { LookupQuery } from '../lookup/query';
import { enabledLists } from '../nav';
import { useSessionMe } from '../shell/SessionGate';
import { createBackfillRunner, type BackfillRunner } from './backfill';

/** Every entry on the enabled lists, from the API (the local copy may be stale or missing). */
const SUMMARY_KEY = ['backfill-entries'] as const;
const summaryKey = (cats: Category[]) => [...SUMMARY_KEY, cats.join(',')] as const;

async function fetchAll(cats: Category[]): Promise<Entry[]> {
  const lists = await Promise.all(cats.map((c) => api.get<Entry[]>(`/api/entries?category=${encodeURIComponent(c)}`)));
  return lists.flat();
}

/** Keeps the summary in step with a saved entry. */
function updateSummary(qc: QueryClient, saved: Entry): void {
  qc.setQueriesData<Entry[]>({ queryKey: SUMMARY_KEY }, (rows) => rows?.map((r) => (r.id === saved.id ? saved : r)));
}

export interface BackfillState {
  running: boolean;
  /** Titles handled in the current (or last) run. */
  done: number;
  /** Titles in the current (or last) run. */
  total: number;
  /** Entries whose best match wasn't clearly the right one (detailsState 'needs_review'). */
  needsReview: number;
  /** Entries still waiting (detailsState 'none'); null until known. */
  pending: number | null;
  start(): void;
  stop(): void;
}

interface Ctx {
  running: boolean;
  done: number;
  total: number;
  categories: Category[];
  start(): void;
  stop(): void;
}
const BackfillContext = createContext<Ctx | null>(null);

/**
 * The app's one backfill runner. It lives above the screens, so it keeps going while you move
 * between them, and stops when the app closes (nothing runs in the background).
 */
export function BackfillProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useSessionMe();
  const categories = useMemo(() => enabledLists(me.settings), [me.settings]);
  const catsRef = useRef(categories);
  catsRef.current = categories;
  const [p, setP] = useState({ running: false, done: 0, total: 0 });
  const runner = useRef<BackfillRunner | null>(null);

  if (!runner.current) {
    runner.current = createBackfillRunner({
      listPending: async () => {
        const rows = await fetchAll(catsRef.current);
        // The listing is the freshest picture: replace the summary (and drop any fetch still in flight).
        await qc.cancelQueries({ queryKey: SUMMARY_KEY });
        qc.setQueryData(summaryKey(catsRef.current), rows);
        return rows.filter((e) => e.detailsState === 'none');
      },
      lookup: async (q: LookupQuery) => {
        const local = await searchOnDevice(q);
        return local ? { info: local } : api.post<{ info: LookupInfo | null }>('/api/lookup', q);
      },
      details: lookupDetails,
      patch: async (id, body) => {
        const saved = await api.patch<Entry>(`/api/entries/${id}`, body);
        writeEntry(qc, saved);
        updateSummary(qc, saved);
        return saved;
      },
      onProgress: setP,
    });
  }
  useEffect(() => {
    const r = runner.current;
    return () => r?.stop();
  }, []);

  const value = useMemo<Ctx>(() => ({
    ...p,
    categories,
    start: () => runner.current?.start(),
    stop: () => runner.current?.stop(),
  }), [p, categories]);
  return <BackfillContext.Provider value={value}>{children}</BackfillContext.Provider>;
}

/** Progress of "Fill in details" plus how many titles still need a hand-picked match. */
export function useBackfill(): BackfillState {
  const ctx = useContext(BackfillContext);
  if (!ctx) throw new Error('useBackfill outside BackfillProvider');
  const summary = useQuery({ queryKey: summaryKey(ctx.categories), queryFn: () => fetchAll(ctx.categories) });
  const rows = summary.data;
  return {
    running: ctx.running,
    done: ctx.done,
    total: ctx.total,
    needsReview: rows ? rows.filter((e) => e.detailsState === 'needs_review').length : 0,
    pending: rows ? rows.filter((e) => e.detailsState === 'none').length : null,
    start: ctx.start,
    stop: ctx.stop,
  };
}
