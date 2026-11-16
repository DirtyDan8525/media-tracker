// The Fix my ratings flow on the tier model (spec v1.2 §5.2, Rulings Q13–Q18): the queue of new
// ratings first (Phase 3 P3/P4), then the home with Fix my ratings per list or season tab and the
// finished titles with no score. Every run is a shared `createRatingSession`; this hook strings
// runs together, loads their rating set and saves. Nothing is saved until Save.
import {
  CATEGORY_CONFIG, createRatingSession, listOfSet, seasonSetOf, tierRange, tiersFor,
  type Category, type Entry, type RatedItem, type RatingChange, type RatingSession, type RatingSet,
  type SetItem, type Tier, type TierSet,
} from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { dropFromQueue, useCompareQueue, type QueueItem } from '../../data/compare';
import { entriesKey } from '../../data/entryCache';
import { fetchRatingSet, ratingSetKey, saveRatingsResult, useRatingSet, type RatingSetData } from '../../data/ratings';
import { refreshCategories, useAllEntries } from '../../data/useEntries';
import { useToast } from '../../design/components/Toast';
import { tierRangeLabels } from '../../design/components/TierPicker';
import { enabledLists, LIST_LABEL, seasonsEnabled } from '../../nav';
import { useSessionMe } from '../../shell/SessionGate';
import type { HomeList, ListCount, TierChips } from './CompareHome';
import type { PairAnswer, PairItem } from './PairView';

export type FlowView =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'home'; afterQueue: boolean; lists: HomeList[]; unrated: ListCount[]; onlyNew: boolean; chosen: RatingSet | null; tiers: TierChips | null }
  | {
    kind: 'ask'; heading: string; sub: string; aId: string; left: PairItem; right: PairItem; progress: string;
    canBack: boolean; settled?: { checked: number; total: number }; tierNames: readonly string[]; tierRanges: string[];
  }
  | {
    kind: 'tier'; item: PairItem; context: string; canBack: boolean;
    tierNames: readonly string[]; ranges: [number, number][];
  }
  | { kind: 'review'; changes: RatingChange[]; canBack: boolean; hasNext: boolean; hasPicks: boolean; conflict: boolean; tierNames: readonly string[] }
  | { kind: 'nothingLeft'; line: string }
  | { kind: 'saving' }
  | { kind: 'saved' };

export interface RatingFlow {
  view: FlowView;
  chooseList(set: RatingSet): void;
  chooseTier(t: Tier | null): void;
  retryTiers(): void;
  startUnrated(c: Category): void;
  answer(a: PairAnswer): void;
  pickTier(t: Tier): void;
  move(id: string, t: Tier): void;
  back(): void;
  save(): Promise<void>;
  dontSave(): void;
  /** Next / Close on All good, Close on Saved and on nothing left. */
  next(): void;
  /** Reload after a save that conflicted: the set changed elsewhere, so this run is dropped. */
  reload(): void;
  /** Leaves the run on screen for the home; nothing is saved and the rest of this visit's queue is dropped. */
  toHome(): void;
  coverOf(id: string): { src: string; square: boolean } | undefined;
}

type RunKind = 'fix' | 'queue' | 'unrated' | 'place';
interface Run {
  kind: RunKind;
  set: RatingSet;
  /** Fix my ratings: the chosen tier (null = all tiers). */
  tier: Tier | null;
  tiers: TierSet;
  session: RatingSession;
  items: Map<string, SetItem>;
  /** Stop pressed (Back undoes it). */
  stopped: boolean;
  /** Put the question's second title on the left. */
  flip: boolean;
  conflict: boolean;
  /** The queued or placed entry this run is for. */
  entryId?: string;
}

type Mode =
  | { kind: 'init' }
  | { kind: 'off' }
  | { kind: 'home'; afterQueue: boolean; chosen: RatingSet | null }
  | { kind: 'starting' }
  | { kind: 'run' }
  | { kind: 'saving' }
  | { kind: 'saved' };

const SAVE_FAILED = "Couldn't save your new ratings. Try again.";
const LOAD_FAILED = "Couldn't load your ratings. Check your connection and try again.";
const UNRATED_MAX = 50; // RATINGS_SAVE_MAX_DONE: a run's `done` list stays within one save

const SEASON_LABEL: Partial<Record<RatingSet, string>> = { anime_seasons: 'Anime Seasons', tv_seasons: 'TV Seasons' };
const setLabel = (set: RatingSet): string => SEASON_LABEL[set] ?? LIST_LABEL[set as Category];

const isRated = (e: Entry) => e.rating !== null || e.tier !== null;
/** Finished titles with no score (Ruling Q17): Completed, or anything on lists without Status. */
const isUnratedFinished = (e: Pick<Entry, 'rating' | 'tier' | 'title' | 'status'>, c: Category) =>
  e.rating === null && e.tier === null && e.title.trim() !== '' && (!CATEGORY_CONFIG[c].hasStatus || e.status === 'Completed');

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const ceilLog2 = (n: number) => Math.ceil(Math.log2(n + 1));

export function useRatingFlow(opts: { place?: string; random?: () => number; onPlaced?: (c: Category) => void } = {}): RatingFlow {
  const me = useSessionMe();
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  const entries = useAllEntries(lists);
  const queue = useCompareQueue();
  const qc = useQueryClient();
  const toast = useToast();
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const st = useRef({
    mode: { kind: 'init' } as Mode,
    run: null as Run | null,
    queue: [] as QueueItem[],
    /** Bumps whenever a run starts or is left, so a late set load can't start a run nobody asked for. */
    gen: 0,
  }).current;

  // The chosen list's set, for its tier chip counts and as the base of a Fix my ratings run.
  const chosen = st.mode.kind === 'home' ? st.mode.chosen : null;
  const chosenSet = useRatingSet(chosen ?? 'anime', chosen !== null);

  const ctx = useRef({ me, lists, data: entries.data, qc, toast, opts, chosenData: chosenSet.data });
  ctx.current = { me, lists, data: entries.data, qc, toast, opts, chosenData: chosenSet.data };

  const actions = useMemo(() => {
    const random = () => (ctx.current.opts.random ?? Math.random)();
    const latest = (c: Category): Entry[] => ctx.current.qc.getQueryData<Entry[]>(entriesKey(c)) ?? ctx.current.data[c] ?? [];
    const ask = () => ctx.current.me.settings.compareAsk;

    const goHome = (afterQueue: boolean, chosen: RatingSet | null = null) => {
      st.gen++;
      st.run = null;
      st.mode = { kind: 'home', afterQueue, chosen };
      rerender();
    };

    /** After every action: a new pick question gets its sides. */
    const settle = () => {
      const run = st.run;
      if (run && run.session.question?.kind === 'pick') run.flip = random() < 0.5;
      rerender();
    };

    const begin = (kind: RunKind, set: RatingSet, data: RatingSetData, tier: Tier | null, mode: Parameters<typeof createRatingSession>[1], entryId?: string) => {
      const tiers = tiersFor(ctx.current.me.settings, set);
      const items = new Map(data.items.map((i) => [i.id, i]));
      const session = createRatingSession({ items: data.items, comparisons: data.comparisons, tiers }, mode);
      st.run = { kind, set, tier, tiers, session, items, stopped: false, flip: false, conflict: false, ...(entryId !== undefined ? { entryId } : {}) };
      st.mode = { kind: 'run' };
      settle();
    };

    /** Loads a set fresh, then starts a run on it, unless the person left meanwhile. */
    const load = async (set: RatingSet, start: (data: RatingSetData) => void, onFail: () => void) => {
      const gen = ++st.gen;
      st.mode = { kind: 'starting' };
      rerender();
      let data: RatingSetData;
      try {
        data = await fetchRatingSet(ctx.current.qc, set);
      } catch {
        if (gen !== st.gen) return;
        ctx.current.toast.show(LOAD_FAILED);
        onFail();
        return;
      }
      if (gen === st.gen) start(data);
    };

    /** One queued (or placed) entry: Place it, or its tier first when it has none. */
    const placeEntry = (q: QueueItem, kind: 'queue' | 'place', onGone: () => void) => {
      void load(q.category, (data) => {
        const item = data.items.find((i) => i.id === q.entryId);
        if (!item) return onGone();
        const mode = item.tier === null ? { kind: 'unrated' as const, ids: [item.id] } : { kind: 'place' as const, ids: [item.id] };
        begin(kind, q.category, data, null, mode, q.entryId);
      }, () => {
        // A set that won't load (offline) would fail for every queued title too: one toast, not one each.
        st.queue = [];
        onGone();
      });
    };

    const placeQueue = (): void => {
      const q = st.queue.shift();
      if (!q) return goHome(true);
      placeEntry(q, 'queue', placeQueue);
    };

    /** `/compare?place=<id>` ends on the title's list (Q16), or home when there is no way back. */
    const leavePlaceFor = (c: Category) => {
      st.gen++;
      st.run = null;
      if (ctx.current.opts.onPlaced) ctx.current.opts.onPlaced(c);
      else goHome(false);
    };

    /** After a run ends (saved, not saved or nothing to save): the next queued title, the list, or home. */
    const after = (savedFix: boolean) => {
      const kind = st.run?.kind;
      if (kind === 'queue') return placeQueue();
      if (kind === 'place') return leavePlaceFor(listOfSet(st.run!.set));
      if (savedFix) { st.run = null; st.mode = { kind: 'saved' }; rerender(); return; }
      goHome(false);
    };

    const reviewing = (): Run | null => {
      const run = st.run;
      return st.mode.kind === 'run' && run && run.session.question === null ? run : null;
    };
    const hasPicks = (run: Run) => {
      const p = run.session.payload();
      return p.picks.some((x) => !x.undone) || p.moves.length > 0;
    };

    return {
      init(queueItems: QueueItem[]) {
        if (ask() === 'Off') { st.mode = { kind: 'off' }; rerender(); return; }
        const place = ctx.current.opts.place;
        // "Place it" follows Ask to compare (Q15): a stale ?place= link must not override Only when I start it.
        if (place && (ask() === 'Both' || ask() === 'Only for new ratings')) {
          for (const c of ctx.current.lists) {
            if (latest(c).some((e) => e.id === place)) return placeEntry({ entryId: place, category: c }, 'place', () => leavePlaceFor(c));
          }
          return goHome(false);
        }
        // Queued titles in a turned-off list wait (Ruling P4); deleted or unrated ones are left out.
        st.queue = ask() === 'Both' || ask() === 'Only for new ratings'
          ? queueItems.filter((q) => ctx.current.lists.includes(q.category)
            && latest(q.category).some((e) => e.id === q.entryId && isRated(e) && e.title.trim() !== ''))
          : [];
        if (st.queue.length) placeQueue();
        else goHome(false);
      },
      chooseList(set: RatingSet) {
        if (st.mode.kind !== 'home') return;
        st.mode = { ...st.mode, chosen: st.mode.chosen === set ? null : set };
        rerender();
      },
      chooseTier(t: Tier | null) {
        if (st.mode.kind !== 'home' || st.mode.chosen === null) return;
        // The chip row's copy may be up to 30 s old: a run starts from the set as the Worker has it now.
        const set = st.mode.chosen;
        if (!ctx.current.chosenData) return;
        void load(set, (data) => begin('fix', set, data, t, { kind: 'fix', tier: t }), () => goHome(false, set));
      },
      retryTiers() {
        if (st.mode.kind === 'home' && st.mode.chosen) void ctx.current.qc.refetchQueries({ queryKey: ratingSetKey(st.mode.chosen) });
      },
      startUnrated(c: Category) {
        const ids = latest(c).filter((e) => isUnratedFinished(e, c))
          .sort((a, b) => collator.compare(a.title, b.title)).slice(0, UNRATED_MAX).map((e) => e.id);
        if (!ids.length) return;
        void load(c, (data) => begin('unrated', c, data, null, { kind: 'unrated', ids }), () => goHome(false));
      },
      answer(a: PairAnswer) {
        const run = st.run;
        if (st.mode.kind !== 'run' || !run || run.session.question === null) return;
        if (a === 'stop') run.stopped = true;
        run.session.answer(a);
        settle();
      },
      pickTier(t: Tier) {
        const run = st.run;
        if (st.mode.kind !== 'run' || run?.session.question?.kind !== 'tier') return;
        run.session.chooseTier(t);
        settle();
      },
      move(id: string, t: Tier) {
        const run = st.run;
        if (st.mode.kind !== 'run' || !run) return;
        run.session.move(id, t);
        settle();
      },
      back() {
        const run = st.run;
        if (st.mode.kind !== 'run' || !run || !run.session.canBack) return;
        run.session.back();
        run.stopped = false;
        run.conflict = false;
        settle();
      },
      async save() {
        const run = reviewing();
        if (!run) return;
        st.mode = { kind: 'saving' };
        rerender();
        const result = await saveRatingsResult(ctx.current.qc, run.set, run.session.payload());
        // The way home is off while saving, but never apply a result to a run that was left.
        if (st.run !== run || st.mode.kind !== 'saving') return;
        if (result !== 'ok') {
          if (result === 'failed') ctx.current.toast.show(SAVE_FAILED);
          run.conflict = result === 'conflict';
          st.mode = { kind: 'run' };
          rerender();
          return;
        }
        after(run.kind === 'fix' || run.kind === 'unrated');
      },
      dontSave() {
        if (reviewing()) after(false);
      },
      next() {
        if (st.mode.kind === 'saved') return goHome(false);
        const run = reviewing();
        if (!run) return;
        // All good with nothing to keep: a queued or placed title is done with (the Phase 3 "skip").
        if (run.entryId !== undefined && !hasPicks(run)) void dropFromQueue(ctx.current.qc, run.entryId);
        after(false);
      },
      reload() {
        const run = st.run;
        if (!run) return;
        void ctx.current.qc.invalidateQueries({ queryKey: ratingSetKey(run.set) });
        void refreshCategories(ctx.current.qc, [listOfSet(run.set)]);
        st.queue = [];
        goHome(false);
      },
      toHome() {
        st.queue = [];
        goHome(false);
      },
      hasPicks,
    };
  }, [st]);

  // Starts once, when the settings, the lists and the queue are in.
  const ready = !entries.isPending && !queue.isPending;
  useEffect(() => {
    if (st.mode.kind !== 'init' || !ready) return;
    actions.init(queue.data ?? []);
  }, [ready, queue.data, actions, st]);

  const { hasPicks: _hasPicks, init: _init, ...publicActions } = actions;
  const coverOf = (id: string) => {
    const i = st.run?.items.get(id);
    return i ? { src: i.cover, square: i.square } : undefined;
  };
  return { view: viewOf(), ...publicActions, coverOf };

  function viewOf(): FlowView {
    const mode = st.mode;
    switch (mode.kind) {
      case 'init': return me.settings.compareAsk === 'Off' ? { kind: 'off' } : { kind: 'loading' };
      case 'off': return { kind: 'off' };
      case 'starting': return { kind: 'loading' };
      case 'saving': return { kind: 'saving' };
      case 'saved': return { kind: 'saved' };
      case 'home': return homeView(mode.afterQueue, mode.chosen);
      case 'run': return runView(st.run!);
    }
  }

  function homeView(afterQueue: boolean, chosenSet_: RatingSet | null): FlowView {
    const ask = me.settings.compareAsk;
    const onlyNew = ask === 'Only for new ratings';
    const homeLists: HomeList[] = [];
    if (!onlyNew) {
      for (const c of lists) {
        const count = (entries.data[c] ?? []).filter(isRated).length;
        if (count >= 2) homeLists.push({ set: c, label: LIST_LABEL[c], icon: c, count });
      }
      for (const c of lists) {
        const s = seasonSetOf(c);
        if (s !== null && seasonsEnabled(me.settings, c)) homeLists.push({ set: s, label: setLabel(s), icon: c, count: null });
      }
    }
    const unrated: ListCount[] = [];
    for (const c of lists) {
      const count = (entries.data[c] ?? []).filter((e) => isUnratedFinished(e, c)).length;
      if (count) unrated.push({ category: c, count });
    }
    let tiers: TierChips | null = null;
    if (chosenSet_ !== null) {
      const names = tiersFor(me.settings, chosenSet_).names;
      const data = chosenSet.data;
      const counts = data ? ([0, 1, 2, 3] as Tier[]).map((t) => data.items.filter((i) => i.tier === t).length) : null;
      tiers = { names, counts, failed: chosenSet.isError && !data };
    }
    return { kind: 'home', afterQueue, lists: homeLists, unrated, onlyNew, chosen: chosenSet_, tiers };
  }

  function runView(run: Run): FlowView {
    const q = run.session.question;
    const names = run.tiers.names;
    const label = setLabel(run.set);
    const pairItem = (i: RatedItem): PairItem => {
      const s = run.items.get(i.id);
      return { id: i.id, title: i.title, rating: i.rating, tier: i.tier, cover: s?.cover ?? '', square: s?.square ?? false };
    };
    if (q === null) {
      const changes = run.session.changes();
      if (run.kind === 'fix' && !run.stopped && !run.session.canBack) {
        return { kind: 'nothingLeft', line: `Nothing left to ask in ${label}${run.tier === null ? '' : ` · ${names[run.tier]}`}. Your order is as settled as your picks make it.` };
      }
      return {
        kind: 'review', changes, canBack: run.session.canBack, hasNext: run.kind === 'queue' && st.queue.length > 0,
        hasPicks: actions.hasPicks(run), conflict: run.conflict, tierNames: names,
      };
    }
    if (q.kind === 'tier') {
      return {
        kind: 'tier', item: pairItem(q.item), context: `${label} · ${q.nth} of ${q.total} with no score`, canBack: run.session.canBack,
        tierNames: names, ranges: ([0, 1, 2, 3] as Tier[]).map((t) => tierRange(run.tiers, t)),
      };
    }
    const a = pairItem(q.a), b = pairItem(q.b);
    const [left, right] = run.flip ? [b, a] : [a, b];
    const base = { kind: 'ask' as const, aId: a.id, left, right, canBack: run.session.canBack, tierNames: names, tierRanges: tierRangeLabels(run.tiers) };
    if (run.kind === 'fix') {
      // In fix mode the session's `nth` is 0-based (picks so far): the question on screen is asked + 1.
      return {
        ...base, heading: 'Fix my ratings', sub: `${label} · ${run.tier === null ? 'All tiers' : names[run.tier]}`,
        progress: `Pick ${run.session.asked + 1}`, settled: run.session.settled,
      };
    }
    const placing = q.placing!;
    const heading = run.kind === 'unrated' ? 'Rate finished things' : 'Place it';
    return { ...base, heading, sub: `${label} · ${placing.tier === null ? '' : names[placing.tier]}`, progress: placingLine(run, placing) };
  }
}

/**
 * "Placing X · pick n of about m": m = ⌈log₂(others in its tier + 1)⌉, the most a binary search
 * over that tier takes (Q13); n counts this session's picks between X and a title in its tier now.
 */
function placingLine(run: Run, placing: RatedItem): string {
  const tierNow = new Map<string, Tier | null>();
  for (const [id, i] of run.items) tierNow.set(id, i.tier);
  for (const c of run.session.changes()) tierNow.set(c.id, c.tier);
  tierNow.set(placing.id, placing.tier);
  let others = 0;
  for (const [id, t] of tierNow) if (id !== placing.id && t === placing.tier) others++;
  const picks = run.session.payload().picks.filter((p) => {
    if (p.undone) return false;
    const other = p.winnerId === placing.id ? p.loserId : p.loserId === placing.id ? p.winnerId : null;
    return other !== null && tierNow.get(other) === placing.tier;
  }).length;
  return `Placing ${placing.title} · pick ${picks + 1} of about ${ceilLog2(others)}`;
}
