import { CATEGORY_CONFIG, normTitle, similarity, type Category, type Entry, type LookupInfo, type Status } from '@media-tracker/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';
import { lookupRunning, patchLocal, writeEntry } from '../data/entryCache';
import { useToast } from '../design/components/Toast';
import { LIST_LABEL } from '../nav';
import { fillDetails } from '../lookup/details';
import { buildInfoPatch, buildLookupQuery } from '../lookup/query';
import { runLookup } from '../lookup/run';

export interface AddInput {
  title: string;
  creator?: string;
  rating?: number | null;
  status?: Status | null;
}

export type AddState = 'idle' | 'looking' | 'choose' | 'saved';
export type SearchResult = 'applied' | 'choices' | 'none';

/** An entry waiting for the user to say which match they meant. */
interface PickJob {
  entry: Entry;
  /** What the user typed (the title rule compares against it). */
  typed: string;
  choices: LookupInfo[];
}

/** The closest match first: by how alike the title is to what was typed (ties keep the server's order). */
export function closestFirst(typed: string, choices: LookupInfo[]): LookupInfo[] {
  const key = normTitle(typed);
  return choices
    .map((c, i) => ({ c, i, s: similarity(key, normTitle(c.title)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

let tempCounter = 0;

/**
 * Adding to a list. add() saves the row at once (pending), then looks it up: one match fills it,
 * several open the picker (`state === 'choose'`), none leaves it "Couldn't find it". retry(),
 * choose(), keepTyped() and search() continue from there.
 */
export function useAddEntry(category: Category) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(0);
  const [saved, setSaved] = useState(false);
  const [queue, setQueue] = useState<PickJob[]>([]);
  const queueRef = useRef<PickJob[]>([]);
  const setJobs = useCallback((jobs: PickJob[]) => { queueRef.current = jobs; setQueue(jobs); }, []);

  const state: AddState = queue.length ? 'choose' : busy ? 'looking' : saved ? 'saved' : 'idle';
  const job = queue[0];

  /** Writes the final lookup state for an entry that found nothing. */
  const markNotFound = useCallback(async (entry: Entry) => {
    patchLocal(qc, entry, { lookupState: 'not_found' });
    lookupRunning.delete(entry.id);
    try {
      writeEntry(qc, await api.patch<Entry>(`/api/entries/${entry.id}`, { lookupState: 'not_found' }));
    } catch {
      // the row already shows not found here; the server's copy is still 'pending', which the list shows the same way
    }
  }, [qc]);

  /** Applies a match to the entry, then fetches its details. */
  const apply = useCallback(async (entry: Entry, typed: string, info: LookupInfo) => {
    const patch = buildInfoPatch(entry, typed, info, 'add');
    patchLocal(qc, entry, patch);
    lookupRunning.delete(entry.id);
    let current: Entry;
    try {
      current = await api.patch<Entry>(`/api/entries/${entry.id}`, patch);
      writeEntry(qc, current);
    } catch {
      toast.show("Couldn't save that match");
      void qc.invalidateQueries({ queryKey: ['entries', entry.category] });
      return;
    }
    await fillDetails(qc, current, info);
  }, [qc, toast]);

  /** Looks up `entry` and either applies the match, queues the picker, or marks it not found. */
  const resolve = useCallback(async (entry: Entry, typed: string, lookup: Promise<LookupInfo | null>) => {
    setBusy((n) => n + 1);
    try {
      const info = await lookup;
      if (!info) return await markNotFound(entry);
      const choices = info.choices ?? [];
      if (choices.length >= 2) {
        setJobs([...queueRef.current, { entry, typed, choices: closestFirst(typed, choices) }]);
        return;
      }
      await apply(entry, typed, choices[0] ?? info);
    } finally {
      setBusy((n) => n - 1);
      setSaved(true);
    }
  }, [apply, markNotFound, setJobs]);

  const add = useCallback(async (input: AddInput): Promise<void> => {
    const title = input.title.trim();
    if (!title) return;
    const cfg = CATEGORY_CONFIG[category];
    const creator = cfg.creatorLabel ? (input.creator ?? '').trim() : '';
    const body: Record<string, unknown> = { category, title, typedTitle: title, lookupState: 'pending' };
    if (creator) body.creator = creator;
    if (input.rating !== undefined && input.rating !== null) body.rating = input.rating;
    if (cfg.hasStatus && input.status) body.status = input.status;

    // The row appears before anything comes back.
    const now = new Date().toISOString();
    const tempId = `tmp-${++tempCounter}`;
    const temp: Entry = {
      id: tempId, userId: '', category, title, typedTitle: title, status: (body.status as Status | undefined) ?? null,
      rating: (body.rating as number | undefined) ?? null, genres: '', creator, album: '', coverUrl: '', notes: '',
      releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none', isPrivate: false, notesPrivate: false,
      source: null, sourceId: null, lookupState: 'pending', importId: null, seasonAvg: null, createdAt: now, updatedAt: now,
    };
    lookupRunning.add(tempId);
    writeEntry(qc, temp, { persist: false });

    const lookup = runLookup(buildLookupQuery(category, title, creator));
    let entry: Entry;
    try {
      const res = await api.post<{ entry: Entry; duplicateOf: string | null }>('/api/entries', body);
      entry = res.entry;
      lookupRunning.add(entry.id);
      lookupRunning.delete(tempId);
      writeEntry(qc, entry, { replaceId: tempId });
      if (res.duplicateOf) toast.show(`Already on your ${LIST_LABEL[category]} list`);
    } catch {
      lookupRunning.delete(tempId);
      removeTemp(qc, temp);
      toast.show("Couldn't save that. Check your connection and try again.");
      return;
    }
    await resolve(entry, title, lookup);
  }, [category, qc, toast, resolve]);

  /** Look an entry up again (Retry), with its own title or `term`. */
  const retry = useCallback(async (entry: Entry, term?: string): Promise<void> => {
    const query = (term ?? entry.title).trim() || entry.title;
    lookupRunning.add(entry.id);
    patchLocal(qc, entry, { lookupState: 'pending' });
    await resolve(entry, entry.typedTitle || entry.title, runLookup(buildLookupQuery(entry.category, query, entry.creator)));
  }, [qc, resolve]);

  const popJob = useCallback(() => setJobs(queueRef.current.slice(1)), [setJobs]);

  /** The picker: apply the chosen card. */
  const choose = useCallback(async (info: LookupInfo): Promise<void> => {
    const j = queueRef.current[0];
    if (!j) return;
    popJob();
    setBusy((n) => n + 1);
    try {
      await apply(j.entry, j.typed, info);
    } finally {
      setBusy((n) => n - 1);
      setSaved(true);
    }
  }, [apply, popJob]);

  /** The picker: "None of these — keep what I typed". */
  const keepTyped = useCallback(async (): Promise<void> => {
    const j = queueRef.current[0];
    if (!j) return;
    popJob();
    await markNotFound(j.entry);
    setSaved(true);
  }, [markNotFound, popJob]);

  /** The picker's search box: run the lookup again with new words. */
  const search = useCallback(async (term: string): Promise<SearchResult> => {
    const j = queueRef.current[0];
    const text = term.trim();
    if (!j || !text) return 'none';
    const info = await runLookup(buildLookupQuery(j.entry.category, text, j.entry.creator));
    if (!info) return 'none';
    const choices = info.choices ?? [];
    if (choices.length >= 2) {
      setJobs([{ ...j, choices: closestFirst(text, choices) }, ...queueRef.current.slice(1)]);
      return 'choices';
    }
    await choose(choices[0] ?? info);
    return 'applied';
  }, [choose, setJobs]);

  return {
    add, state, choices: job?.choices ?? [], retry, choose, keepTyped, search,
    /** The entry the picker is about, and what was typed for it. */
    pickTarget: job ? { entry: job.entry, typed: job.typed } : null,
  };
}

function removeTemp(qc: QueryClient, temp: Entry): void {
  qc.setQueryData<Entry[]>(['entries', temp.category], (rows) => rows?.filter((r) => r.id !== temp.id));
}

