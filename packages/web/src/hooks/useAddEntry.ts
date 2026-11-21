import { PLAN_STATUS, normTitle, similarity, type Category, type Entry, type LookupInfo, type Status } from '@media-tracker/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';
import { CLOSE_COUNTS_KEY } from '../data/ratings';
import { COMPLETED, announceCompleted } from '../data/rateOnComplete';
import { lookupRunning, patchLocal, writeEntry } from '../data/entryCache';
import { useToast } from '../design/components/Toast';
import { applyLookupMatch } from '../lookup/apply';
import { buildLookupQuery } from '../lookup/query';
import { runLookup } from '../lookup/run';
import { listCfg } from '../lists/registry';
import { rememberAddList } from '../shell/lastAddList';

export interface AddInput {
  title: string;
  creator?: string;
  /** A typed number: the truth (Ruling N1). Never sent for a Plan to watch title (N8). */
  rating?: number | null;
  status?: Status | null;
  /** The list to add to (the Add sheet's "Add to"); default: the list the hook was made for. */
  category?: Category;
  /** A note typed in the Add sheet (Dan, 2026-11-17). */
  notes?: string;
  /** A custom list's Link column: a web or map link (http/https). */
  link?: string;
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
/** Asked before adding a second copy of a title (Dan, 2026-11-16): resolve true to add it again. */
export type ConfirmDuplicate = (title: string, category: Category, existingId: string) => Promise<boolean>;

/** Called as soon as the row is saved (before its lookup finishes). */
export type OnSaved = (entry: Entry) => void;

export function useAddEntry(defaultCategory: Category, confirmDuplicate?: ConfirmDuplicate, onSaved?: OnSaved) {
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
    if (!(await applyLookupMatch(qc, entry, typed, info))) toast.show("Couldn't save that match");
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

  /** Saves the entry and looks it up. Resolves to the saved entry, or null when nothing was added. */
  const add = useCallback(async (input: AddInput): Promise<Entry | null> => {
    const title = input.title.trim();
    if (!title) return null;
    const category = input.category ?? defaultCategory;
    const cfg = listCfg(category);
    const creator = cfg.creatorLabel ? (input.creator ?? '').trim() : '';
    // A custom list with no search ("type it in"): what was typed is the whole title, nothing is looked up.
    const typeIn = cfg.lookup === null;
    const body: Record<string, unknown> = { category, title, typedTitle: title, lookupState: typeIn ? 'ok' : 'pending' };
    if (creator) body.creator = creator;
    const link = cfg.showLink ? (input.link ?? '').trim() : '';
    if (link) body.link = link;
    if (input.notes) body.notes = input.notes;
    if (cfg.hasStatus && input.status) body.status = input.status;
    if (input.rating !== undefined && input.rating !== null && body.status !== PLAN_STATUS) body.rating = input.rating;

    // The row appears before anything comes back.
    const now = new Date().toISOString();
    const tempId = `tmp-${++tempCounter}`;
    const temp: Entry = {
      id: tempId, userId: '', category, title, typedTitle: title, status: (body.status as Status | undefined) ?? null,
      rating: (body.rating as number | undefined) ?? null, typed: (body.rating as number | undefined) ?? null, genres: '', creator, album: '', coverUrl: '', notes: input.notes ?? '',
      releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none', isPrivate: false, notesPrivate: false,
      source: null, sourceId: null, lookupState: typeIn ? 'ok' : 'pending', link, importId: null, seasonAvg: null, tier: null, priorMean: null, strength: null, scoreLocked: false, createdAt: now, updatedAt: now,
    };
    lookupRunning.add(tempId);
    writeEntry(qc, temp, { persist: false });

    let entry: Entry;
    let lookup: ReturnType<typeof runLookup> | null = null;
    try {
      let res: { entry: Entry; duplicateOf: string | null };
      try {
        res = await api.post<{ entry: Entry; duplicateOf: string | null }>('/api/entries', body);
      } catch (err) {
        // Already on the list: nothing was written. Ask; "Add again" re-posts with allowDuplicate.
        if (!(err instanceof ApiError && err.status === 409 && err.error === 'duplicate')) throw err;
        const existingId = (err.body as { duplicateOf?: string } | undefined)?.duplicateOf ?? '';
        removeTemp(qc, temp);
        lookupRunning.delete(tempId);
        const again = confirmDuplicate ? await confirmDuplicate(title, category, existingId) : false;
        if (!again) return null;
        lookupRunning.add(tempId);
        writeEntry(qc, temp, { persist: false });
        res = await api.post<{ entry: Entry; duplicateOf: string | null }>('/api/entries', { ...body, allowDuplicate: true });
      }
      lookup = typeIn ? null : runLookup(buildLookupQuery(category, title, creator));
      entry = res.entry;
      lookupRunning.add(entry.id);
      lookupRunning.delete(tempId);
      writeEntry(qc, entry, { replaceId: tempId });
      rememberAddList(category); // Add opens on this list next time, from screens that are not a list
      onSaved?.(entry);
      if (entry.rating !== null) void qc.invalidateQueries({ queryKey: CLOSE_COUNTS_KEY });
      else if (entry.status === COMPLETED) announceCompleted(entry);
    } catch {
      lookupRunning.delete(tempId);
      removeTemp(qc, temp);
      toast.show("Couldn't save that. Check your connection and try again.");
      return null;
    }
    if (!lookup) {
      lookupRunning.delete(entry.id);
      setSaved(true);
      return entry;
    }
    await resolve(entry, title, lookup);
    return entry;
  }, [defaultCategory, qc, toast, resolve, confirmDuplicate, onSaved]);

  /** Look an entry up again (Retry), with its own title or `term`. */
  const retry = useCallback(async (entry: Entry, term?: string): Promise<void> => {
    if (listCfg(entry.category).lookup === null) return;
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

