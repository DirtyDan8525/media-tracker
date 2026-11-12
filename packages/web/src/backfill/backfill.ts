import {
  CATEGORY_CONFIG,
  normTitle,
  similarity,
  type Details,
  type Entry,
  type LookupInfo,
} from '@media-tracker/shared';

export type BackfillResult = 'filled' | 'needs_review' | 'skipped';

export interface LookupQuery {
  category: Entry['category'];
  term: string;
  typedTitle: string;
  hint: string;
}

/** The body of PATCH /api/entries/:id: the four detail fields and detailsState, nothing else. */
export type BackfillPatch = Partial<Pick<Entry, 'releaseDate' | 'synopsis' | 'lengthLabel' | 'origin'>> & {
  detailsState: 'filled' | 'needs_review';
};

export interface BackfillDeps {
  lookup(q: LookupQuery): Promise<{ info: LookupInfo | null }>;
  details(q: { source: NonNullable<LookupInfo['source']>; sourceId: string }): Promise<{ details: Details | null }>;
  patch(id: string, body: BackfillPatch): Promise<unknown>;
}

const DETAIL_FIELDS = ['releaseDate', 'synopsis', 'lengthLabel', 'origin'] as const;
const TITLE_MIN = 0.9;
const CREATOR_MIN = 0.8;

/**
 * Tries to fill the empty detail fields of one imported entry.
 *  - 'filled': the match was confirmed; any new detail fields were applied (possibly none) and detailsState is 'filled'.
 *  - 'needs_review': the best lookup result is not clearly the same title/creator; flagged for the picker.
 *  - 'skipped': nothing was written (error, nothing found, no sourceId, or a thrown/rejected call). detailsState stays 'none' so a later run retries.
 */
export async function backfillOne(entry: Entry, deps: BackfillDeps): Promise<BackfillResult> {
  try {
    const hint = CATEGORY_CONFIG[entry.category].creatorIsSearchHint;
    const { info } = await deps.lookup({
      category: entry.category,
      term: entry.title + (hint && entry.creator ? ' ' + entry.creator : ''),
      typedTitle: entry.title,
      hint: hint ? entry.creator : '',
    });
    if (!info) return 'skipped';

    const titleOk = similarity(normTitle(entry.title), normTitle(info.title)) >= TITLE_MIN;
    const creatorOk =
      !entry.creator || similarity(normTitle(entry.creator), normTitle(info.creator)) >= CREATOR_MIN;
    if (!titleOk || !creatorOk) {
      await deps.patch(entry.id, { detailsState: 'needs_review' });
      return 'needs_review';
    }

    if (!info.sourceId) return 'skipped';
    const { details } = await deps.details({ source: info.source, sourceId: info.sourceId });

    const body: BackfillPatch = { detailsState: 'filled' };
    for (const f of DETAIL_FIELDS) {
      const incoming = details?.[f];
      if (!entry[f] && incoming) body[f] = incoming;
    }
    // A confirmed match with nothing (more) to add is still done: mark it filled so it isn't re-queried.

    await deps.patch(entry.id, body);
    return 'filled';
  } catch {
    return 'skipped';
  }
}

export interface BackfillProgress {
  done: number;
  total: number;
  running: boolean;
}

export interface BackfillRunnerOptions extends BackfillDeps {
  /** Entries with detailsState === 'none' (from the local cache or the API). */
  listPending(): Promise<Entry[]>;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onProgress?: (p: BackfillProgress) => void;
  /** Per-item worker; defaults to backfillOne. Injectable for tests. */
  processItem?: (entry: Entry, deps: BackfillDeps) => Promise<unknown>;
}

export interface BackfillRunner {
  start(): void;
  stop(): void;
  readonly running: boolean;
  readonly done: number;
  readonly total: number;
}

/**
 * Runs backfillOne over pending entries, one per intervalMs, never more than one in flight.
 *
 * Resuming: a new start() calls listPending() again. Entries that ended 'filled' or 'needs_review'
 * are no longer 'none', so a fresh run naturally continues where the last one stopped. Entries that
 * were 'skipped' stay 'none' and are retried on the next run, but never twice within one run.
 */
export function createBackfillRunner(opts: BackfillRunnerOptions): BackfillRunner {
  const interval = opts.intervalMs ?? 1500;
  const processItem = opts.processItem ?? backfillOne;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let running = false;
  let done = 0;
  let total = 0;
  let timer: unknown = null;
  let runId = 0;
  /** The item currently being processed, kept across stop()/start() so two never overlap. */
  let inFlight: { id: string; promise: Promise<unknown> } | null = null;

  const emit = () => opts.onProgress?.({ done, total, running });

  async function run(id: number): Promise<void> {
    // Capture before listing: the item may settle while listPending() is still fetching, and the
    // listing taken meanwhile can still contain it.
    const prior = inFlight;
    let queue: Entry[];
    try {
      queue = await opts.listPending();
    } catch {
      if (id === runId) { running = false; emit(); }
      return;
    }
    if (id !== runId) return;
    // A previous run may still have an item in flight (stop() doesn't cancel it): let it settle and
    // leave that entry out so it is neither concurrent nor repeated.
    if (prior) {
      await prior.promise.catch(() => {});
      if (id !== runId) return;
    }
    const seen = new Set<string>(prior ? [prior.id] : []);
    queue = queue.filter((e) => !seen.has(e.id) && !!seen.add(e.id));
    total = queue.length;
    emit();

    let i = 0;
    const step = async (): Promise<void> => {
      timer = null;
      if (id !== runId || !running) return;
      if (i >= queue.length) { running = false; emit(); return; }
      const item = queue[i++]!;
      const promise = Promise.resolve().then(() => processItem(item, opts));
      inFlight = { id: item.id, promise };
      try {
        await promise;
      } catch {
        // backfillOne never rejects; a custom processItem must not stop the run either.
      } finally {
        if (inFlight?.promise === promise) inFlight = null;
      }
      if (id !== runId) return; // stopped (and possibly restarted) while in flight
      done++;
      emit();
      if (!running) return;
      if (i >= queue.length) { running = false; emit(); return; }
      timer = setTimer(() => { void step(); }, interval);
    };
    await step();
  }

  return {
    start() {
      if (running) return;
      running = true;
      done = 0;
      total = 0;
      runId++;
      void run(runId);
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer !== null) { clearTimer(timer); timer = null; }
      emit();
    },
    get running() { return running; },
    get done() { return done; },
    get total() { return total; },
  };
}
