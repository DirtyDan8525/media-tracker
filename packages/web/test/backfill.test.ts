import { describe, expect, it, vi } from 'vitest';
import { normTitle, similarity, type Details, type Entry, type LookupInfo } from '@media-tracker/shared';
import { backfillOne, createBackfillRunner } from '../src/backfill/backfill';

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1', userId: 'u1', category: 'anime', title: 'Cowboy Bebop', typedTitle: 'cowboy bebop',
    status: 'completed' as Entry['status'], rating: 9, genres: '', creator: 'Sunrise', album: '',
    coverUrl: 'c.jpg', notes: 'my notes', releaseDate: '', synopsis: '', lengthLabel: '', origin: '',
    detailsState: 'none', isPrivate: false, notesPrivate: false, source: null, sourceId: null,
    lookupState: 'ok', importId: null, seasonAvg: null, createdAt: 'x', updatedAt: 'x', ...over,
  };
}
function info(over: Partial<LookupInfo> = {}): LookupInfo {
  return { title: 'Cowboy Bebop', trusted: true, cover: 'new.jpg', genres: 'Action', creator: 'Sunrise',
    source: 'anilist' as LookupInfo['source'], sourceId: '1', ...over };
}
const FULL: Details = { releaseDate: '1998-04-03', synopsis: 'Space bounty hunters.', lengthLabel: '26 eps', origin: 'TV' };

function deps(i: LookupInfo | null = info(), d: Details | null = FULL) {
  return {
    lookup: vi.fn(async () => ({ info: i })),
    details: vi.fn(async () => ({ details: d })),
    patch: vi.fn(async (_id: string, _body: Record<string, unknown>): Promise<unknown> => undefined),
  };
}

describe('backfillOne', () => {
  it('fills only the four detail fields plus detailsState on an exact match', async () => {
    const dp = deps();
    expect(await backfillOne(entry(), dp)).toBe('filled');
    expect(dp.details).toHaveBeenCalledWith({ source: 'anilist', sourceId: '1' });
    expect(dp.patch).toHaveBeenCalledTimes(1);
    const [id, body] = dp.patch.mock.calls[0]!;
    expect(id).toBe('e1');
    expect(Object.keys(body).sort()).toEqual(['detailsState', 'lengthLabel', 'origin', 'releaseDate', 'synopsis']);
    expect(body).toEqual({ ...FULL, detailsState: 'filled' });
  });

  it('builds the lookup query, adding the creator to the term only for hint categories', async () => {
    const a = deps();
    await backfillOne(entry(), a);
    expect(a.lookup).toHaveBeenCalledWith({ category: 'anime', term: 'Cowboy Bebop', typedTitle: 'Cowboy Bebop', hint: '' });
    const b = deps(info({ title: 'Blue', creator: 'Joni Mitchell' }));
    await backfillOne(entry({ category: 'albums', title: 'Blue', creator: 'Joni Mitchell' }), b);
    expect(b.lookup).toHaveBeenCalledWith({ category: 'albums', term: 'Blue Joni Mitchell', typedTitle: 'Blue', hint: 'Joni Mitchell' });
  });

  it('marks a same-title, different-creator result needs_review', async () => {
    const dp = deps(info({ title: 'Blue', creator: 'Weezer' }));
    const r = await backfillOne(entry({ category: 'albums', title: 'Blue', creator: 'Joni Mitchell' }), dp);
    expect(r).toBe('needs_review');
    expect(dp.patch).toHaveBeenCalledWith('e1', { detailsState: 'needs_review' });
    expect(dp.details).not.toHaveBeenCalled();
  });

  it('keeps an existing synopsis', async () => {
    const dp = deps();
    expect(await backfillOne(entry({ synopsis: 'Mine' }), dp)).toBe('filled');
    const body = dp.patch.mock.calls[0]![1];
    expect(body).not.toHaveProperty('synopsis');
    expect(body.releaseDate).toBe('1998-04-03');
  });

  it('matches on title alone when the entry has no creator', async () => {
    const dp = deps(info({ creator: 'Whoever' }));
    expect(await backfillOne(entry({ creator: '' }), dp)).toBe('filled');
  });

  it('sends needs_review when title similarity is just under 0.9', async () => {
    const mine = 'Cowboy Bebop Tokyo Kids';
    const theirs = 'Cowboy Bebop Tokya Kids';
    const s = similarity(normTitle(mine), normTitle(theirs));
    expect(s).toBeGreaterThan(0.88);
    expect(s).toBeLessThan(0.9);
    const dp = deps(info({ title: theirs }));
    expect(await backfillOne(entry({ title: mine }), dp)).toBe('needs_review');
    expect(dp.patch).toHaveBeenCalledWith('e1', { detailsState: 'needs_review' });
  });

  it('skips with no PATCH when lookup throws', async () => {
    const dp = deps();
    dp.lookup.mockRejectedValue(new Error('down'));
    expect(await backfillOne(entry(), dp)).toBe('skipped');
    expect(dp.patch).not.toHaveBeenCalled();
  });

  it('skips with no PATCH when nothing is found', async () => {
    const dp = deps(null);
    expect(await backfillOne(entry(), dp)).toBe('skipped');
    expect(dp.patch).not.toHaveBeenCalled();
  });

  it('skips when the match has no sourceId', async () => {
    const dp = deps(info({ sourceId: undefined }));
    expect(await backfillOne(entry(), dp)).toBe('skipped');
    expect(dp.details).not.toHaveBeenCalled();
    expect(dp.patch).not.toHaveBeenCalled();
  });

  it('skips with no PATCH when details throws or the patch is rejected', async () => {
    const a = deps();
    a.details.mockRejectedValue(new Error('boom'));
    expect(await backfillOne(entry(), a)).toBe('skipped');
    expect(a.patch).not.toHaveBeenCalled();
    const b = deps();
    b.patch.mockRejectedValue(new Error('500'));
    expect(await backfillOne(entry(), b)).toBe('skipped');
  });

  it('null details on a confirmed match still marks filled with only detailsState', async () => {
    const dp = deps(info(), null);
    expect(await backfillOne(entry(), dp)).toBe('filled');
    expect(dp.patch).toHaveBeenCalledWith('e1', { detailsState: 'filled' });
  });

  it('partial details that fill some gaps still mark filled with only the new fields', async () => {
    const dp = deps(info(), { releaseDate: '', synopsis: 'New', lengthLabel: '', origin: '' });
    expect(await backfillOne(entry(), dp)).toBe('filled');
    expect(dp.patch).toHaveBeenCalledWith('e1', { synopsis: 'New', detailsState: 'filled' });
  });
});

/** Manual timer: setTimer records the callback; tick() fires it. */
function manualTimers() {
  const waits: number[] = [];
  let cb: (() => void) | null = null;
  return {
    waits,
    setTimer: (fn: () => void, ms: number) => { waits.push(ms); cb = fn; return 1 as unknown; },
    clearTimer: () => { cb = null; },
    async tick() { const f = cb; cb = null; f?.(); await flush(); },
    get pending() { return cb !== null; },
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function runnerFor(list: Entry[], extra: Partial<Parameters<typeof createBackfillRunner>[0]> = {}) {
  const t = manualTimers();
  const processed: string[] = [];
  const onProgress = vi.fn();
  const runner = createBackfillRunner({
    listPending: async () => list,
    lookup: async (q) => { processed.push(q.typedTitle); return { info: null }; },
    details: async () => ({ details: null }),
    patch: async () => undefined,
    setTimer: t.setTimer as never,
    clearTimer: t.clearTimer as never,
    onProgress,
    ...extra,
  });
  return { runner, t, processed, onProgress };
}
const three = [entry({ id: 'a', title: 'A' }), entry({ id: 'b', title: 'B' }), entry({ id: 'c', title: 'C' })];

describe('createBackfillRunner', () => {
  it('processes N items with exactly N-1 waits of 1500 ms', async () => {
    const { runner, t, processed } = runnerFor(three);
    runner.start();
    await flush();
    expect(processed).toEqual(['A']);
    expect(runner.running).toBe(true);
    await t.tick();
    await t.tick();
    expect(processed).toEqual(['A', 'B', 'C']);
    expect(t.waits).toEqual([1500, 1500]);
    expect(t.pending).toBe(false);
    expect(runner.running).toBe(false);
    expect(runner.done).toBe(3);
    expect(runner.total).toBe(3);
  });

  it('stop() halts after the current item and starts nothing new', async () => {
    const { runner, t, processed } = runnerFor(three);
    runner.start();
    await flush();
    runner.stop();
    expect(runner.running).toBe(false);
    await t.tick();
    expect(processed).toEqual(['A']);
    expect(runner.done).toBe(1);
  });

  it('stop() during an in-flight item lets it finish but starts no more', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const processed: string[] = [];
    const t = manualTimers();
    const runner = createBackfillRunner({
      listPending: async () => three,
      lookup: async (q) => { processed.push(q.typedTitle); await gate; return { info: null }; },
      details: async () => ({ details: null }), patch: async () => undefined,
      setTimer: t.setTimer as never, clearTimer: t.clearTimer as never,
    });
    runner.start();
    await flush();
    runner.stop();
    release();
    await flush();
    expect(runner.done).toBe(1);
    expect(t.pending).toBe(false);
    expect(processed).toEqual(['A']);
  });

  it('never processes the same id twice in one run even if listPending returns it again', async () => {
    let calls = 0;
    const t = manualTimers();
    const processed: string[] = [];
    const runner = createBackfillRunner({
      listPending: async () => { calls++; return three; },
      lookup: async (q) => { processed.push(q.typedTitle); return { info: null }; },
      details: async () => ({ details: null }), patch: async () => undefined,
      setTimer: t.setTimer as never, clearTimer: t.clearTimer as never,
    });
    runner.start();
    await flush();
    for (let i = 0; i < 5; i++) await t.tick();
    expect(processed).toEqual(['A', 'B', 'C']);
    expect(calls).toBe(1);
    // A new run re-lists and retries the skipped entries.
    runner.start();
    await flush();
    for (let i = 0; i < 5; i++) await t.tick();
    expect(processed).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
  });

  it('keeps going after an item error and reports progress', async () => {
    const t = manualTimers();
    const onProgress = vi.fn();
    let n = 0;
    const runner = createBackfillRunner({
      listPending: async () => three,
      lookup: async () => { if (n++ === 0) throw new Error('x'); return { info: null }; },
      details: async () => ({ details: null }), patch: async () => undefined,
      setTimer: t.setTimer as never, clearTimer: t.clearTimer as never, onProgress,
    });
    runner.start();
    await flush();
    await t.tick();
    await t.tick();
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 3, running: true },
      { done: 1, total: 3, running: true },
      { done: 2, total: 3, running: true },
      { done: 3, total: 3, running: true },
      { done: 3, total: 3, running: false },
    ]);
  });

  it('reports a stop and ignores a second start() while running', async () => {
    const { runner, processed, onProgress } = runnerFor(three);
    runner.start();
    runner.start();
    await flush();
    expect(processed).toEqual(['A']);
    runner.stop();
    expect(onProgress).toHaveBeenLastCalledWith({ done: 1, total: 3, running: false });
  });

  it('with nothing pending, finishes immediately', async () => {
    const { runner, onProgress } = runnerFor([]);
    runner.start();
    await flush();
    expect(runner.running).toBe(false);
    expect(runner.total).toBe(0);
    expect(onProgress).toHaveBeenLastCalledWith({ done: 0, total: 0, running: false });
  });

  it('stop then immediate start while an item is in flight: no concurrent or duplicate processing', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: string[] = [];
    const gates: Array<() => void> = [];
    const t = manualTimers();
    const runner = createBackfillRunner({
      listPending: async () => three,
      lookup: async (q) => {
        started.push(q.typedTitle);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (q.typedTitle === 'A' && started.filter((x) => x === 'A').length === 1) {
          await new Promise<void>((r) => gates.push(r));
        }
        inFlight--;
        return { info: null };
      },
      details: async () => ({ details: null }), patch: async () => undefined,
      setTimer: t.setTimer as never, clearTimer: t.clearTimer as never,
    });
    runner.start();
    await flush();
    expect(started).toEqual(['A']);
    runner.stop();
    runner.start();
    await flush();
    expect(started).toEqual(['A']); // new run waits for A to settle
    gates[0]!();
    await flush();
    expect(started).toEqual(['A', 'B']); // A is not repeated in the new run
    for (let i = 0; i < 5; i++) await t.tick();
    expect(started).toEqual(['A', 'B', 'C']);
    expect(maxInFlight).toBe(1);
  });
});
