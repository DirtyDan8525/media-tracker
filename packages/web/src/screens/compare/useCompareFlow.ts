// The Compare dialog's flow (reference/MediaTrackerCovers.gs, COMPARE_HTML 2128–2167): the queue of new
// ratings first, then the home screen with a full pass per list and the unrated finished titles.
// The runs and Back are the shared engine's; this hook only strings runs together and saves.
import {
  compareLists, createSession, fullPass, placeOne, placeUnrated, ratedItems, unratedFinished,
  type Answer, type Category, type CompareItem, type CompareOptions, type CompareRoom, type CompareRun,
  type CompareStyle, type Entry, type Question, type RatingChange, type Session,
} from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { dropFromQueue, saveCompareChanges, useCompareQueue, type QueueItem } from '../../data/compare';
import { entriesKey } from '../../data/entryCache';
import { useAllEntries } from '../../data/useEntries';
import { useToast } from '../../design/components/Toast';
import { enabledLists, LIST_LABEL } from '../../nav';
import { useSessionMe } from '../../shell/SessionGate';

export interface ListCount { category: Category; count: number }

export type FlowView =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'home'; afterQueue: boolean; lists: ListCount[]; unrated: ListCount[]; onlyNew: boolean }
  | { kind: 'ask'; question: Question; left: CompareItem; right: CompareItem; canBack: boolean }
  | { kind: 'review'; changes: RatingChange[]; asked: number; canBack: boolean; hasNext: boolean }
  | { kind: 'nothingToCompare'; title: string; listName: string }
  | { kind: 'saving' }
  | { kind: 'saved' };

export interface CompareFlow {
  view: FlowView;
  startList(c: Category): void;
  startUnrated(c: Category): void;
  answer(a: Answer): void;
  back(): void;
  save(): Promise<void>;
  dontSave(): void;
  /** "Next" / "Close" on All good (drops a queued title first), Next on nothing-to-compare, Close on Saved. */
  next(): void;
  /** Leaves the run on screen for the home screen; nothing is saved and the rest of this visit's queue is dropped. */
  toHome(): void;
}

type RunKind = 'full' | 'queue' | 'unrated';
interface Run { kind: RunKind; session: Session; doneEntryId?: string }
type Mode =
  | { kind: 'init' }
  | { kind: 'off' }
  | { kind: 'home'; afterQueue: boolean }
  | { kind: 'run' }
  | { kind: 'nothing'; title: string; listName: string }
  | { kind: 'saving' }
  | { kind: 'saved' };

type Unrated = CompareItem & { category: Category };

const SAVE_FAILED = "Couldn't save your new ratings. Try again.";

export function useCompareFlow(opts: { random?: () => number } = {}): CompareFlow {
  const me = useSessionMe();
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  const entries = useAllEntries(lists);
  const queue = useCompareQueue();
  const qc = useQueryClient();
  const toast = useToast();
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Everything the actions read, kept current on every render so the actions themselves never change.
  const ctx = useRef({ me, lists, data: entries.data, qc, toast, random: opts.random });
  ctx.current = { me, lists, data: entries.data, qc, toast, random: opts.random };

  const st = useRef({
    mode: { kind: 'init' } as Mode,
    run: null as Run | null,
    queue: [] as QueueItem[],
    unratedList: [] as Unrated[],
    unratedTotal: 0,
    shown: new Set<string>(), // unrated titles already offered this visit (the script's S.unrated filter)
    flip: false,
  }).current;

  const actions = useMemo(() => {
    // The freshest copy of a list: the query cache (a save writes there at once), else what was rendered.
    const latest = (c: Category): Entry[] => ctx.current.qc.getQueryData<Entry[]>(entriesKey(c)) ?? ctx.current.data[c] ?? [];
    const options = (): CompareOptions => {
      const s = ctx.current.me.settings;
      return { style: s.compareStyle as CompareStyle, room: s.compareRoom as CompareRoom, window: s.compareWindow };
    };
    const random = () => (ctx.current.random ?? Math.random)();

    const goHome = (afterQueue: boolean) => {
      st.run = null;
      st.mode = { kind: 'home', afterQueue };
      rerender();
    };

    // After every answer, Back or new run: a new question gets its sides; a run that moved on goes on.
    const settle = () => {
      const run = st.run!;
      const cur = run.session.current;
      if (cur.kind === 'ask') st.flip = random() < 0.5; // don't always put the higher-rated one on the left
      else if (cur.outcome.kind === 'skipped') return next();
      rerender();
    };

    const startRun = (kind: RunKind, start: (s: Session | undefined) => CompareRun, doneEntryId?: string) => {
      // `start` runs again on every Back, so it can read the session (ruling: placeOne's `waiting` after Stop).
      let session: Session | undefined = undefined;
      session = createSession(() => start(session));
      st.run = doneEntryId === undefined ? { kind, session } : { kind, session, doneEntryId };
      st.mode = { kind: 'run' };
      settle();
    };

    const placeQueue = (): void => {
      const q = st.queue.shift();
      if (!q) return goHome(true);
      const items = ratedItems(latest(q.category));
      const waiting = st.queue.length;
      startRun('queue', (s) => placeOne(items, q.entryId, LIST_LABEL[q.category], s?.stopRequested ? 0 : waiting, options()), q.entryId);
    };

    const unratedLeft = (): Unrated[] => {
      const byCategory: Partial<Record<Category, Entry[]>> = {};
      for (const c of ctx.current.lists) byCategory[c] = latest(c);
      return unratedFinished(byCategory, ctx.current.lists).filter((u) => !st.shown.has(u.id));
    };

    const nextUnrated = (): void => {
      const u = st.unratedList.shift();
      if (!u) return goHome(false);
      st.shown.add(u.id);
      const nth = st.unratedTotal - st.unratedList.length, total = st.unratedTotal;
      const items = ratedItems(latest(u.category));
      const listName = LIST_LABEL[u.category];
      startRun('unrated', () => placeUnrated(items, u, listName, nth, total, options()));
      if (st.run?.session.current.kind === 'done' && st.run.session.current.outcome.kind === 'nothingToCompare') {
        st.mode = { kind: 'nothing', title: u.title, listName };
        rerender();
      }
    };

    function next(): void {
      const kind = st.run?.kind;
      if (kind === 'queue') placeQueue();
      else if (kind === 'unrated') nextUnrated();
      else goHome(false);
    }

    const reviewChanges = (): RatingChange[] | null => {
      const cur = st.run?.session.current;
      return cur?.kind === 'done' && cur.outcome.kind === 'review' ? cur.outcome.changes : null;
    };

    return {
      init(queueItems: QueueItem[]) {
        const ask = ctx.current.me.settings.compareAsk;
        if (ask === 'Off') { st.mode = { kind: 'off' }; rerender(); return; }
        // Queued titles in a turned-off list wait (Ruling P4); deleted or un-rated ones are dropped, as the script's open.
        st.queue = ask === 'Both' || ask === 'Only for new ratings'
          ? queueItems.filter((q) => ctx.current.lists.includes(q.category)
            && latest(q.category).some((e) => e.id === q.entryId && e.rating !== null && e.title.trim() !== ''))
          : [];
        if (st.queue.length) placeQueue();
        else goHome(false);
      },
      startList(c: Category) {
        const items = ratedItems(latest(c));
        startRun('full', () => fullPass(items, LIST_LABEL[c], options()));
      },
      startUnrated(c: Category) {
        st.unratedList = unratedLeft().filter((u) => u.category === c);
        st.unratedTotal = st.unratedList.length;
        nextUnrated();
      },
      answer(a: Answer) {
        const run = st.run;
        if (st.mode.kind !== 'run' || !run || run.session.current.kind !== 'ask') return;
        run.session.answer(a);
        // The script's `S.queue.length = 0` / `unratedList.length = 0`: for good, Back or not.
        if (run.session.stopRequested) {
          if (run.kind === 'queue') st.queue = [];
          if (run.kind === 'unrated') st.unratedList = [];
        }
        settle();
      },
      back() {
        const run = st.run;
        if (st.mode.kind !== 'run' || !run || !run.session.canBack) return;
        run.session.back();
        settle();
      },
      async save() {
        const run = st.run, changes = reviewChanges();
        if (st.mode.kind !== 'run' || !run || !changes) return;
        st.mode = { kind: 'saving' };
        rerender();
        const body = changes.map(({ id, rating }) => ({ id, rating }));
        const ok = run.doneEntryId === undefined
          ? await saveCompareChanges(ctx.current.qc, body)
          : await saveCompareChanges(ctx.current.qc, body, run.doneEntryId);
        // The person can't leave while saving (the home control is off), but never apply a result to another run.
        if (st.run !== run || st.mode.kind !== 'saving') {
          if (!ok) ctx.current.toast.show(SAVE_FAILED);
          return;
        }
        if (!ok) {
          ctx.current.toast.show(SAVE_FAILED);
          st.mode = { kind: 'run' };
          rerender();
          return;
        }
        if (run.kind === 'full') { st.mode = { kind: 'saved' }; rerender(); }
        else next();
      },
      dontSave() {
        if (st.mode.kind === 'run' && reviewChanges()) next();
      },
      next() {
        if (st.mode.kind === 'saved') return goHome(false);
        if (st.mode.kind === 'nothing') return next();
        const changes = reviewChanges();
        if (st.mode.kind !== 'run' || !changes || changes.length) return;
        if (st.run?.doneEntryId !== undefined) void dropFromQueue(ctx.current.qc, st.run.doneEntryId);
        next();
      },
      toHome() {
        st.queue = [];
        st.unratedList = [];
        goHome(false);
      },
    };
  }, [st]);

  // Starts once, when the settings, the lists and the queue are in.
  const ready = !entries.isPending && !queue.isPending;
  useEffect(() => {
    if (st.mode.kind !== 'init' || !ready) return;
    actions.init(queue.data ?? []);
  }, [ready, queue.data, actions, st]);

  return { view: viewOf(), ...actions };

  function viewOf(): FlowView {
    const mode = st.mode;
    switch (mode.kind) {
      case 'init': return me.settings.compareAsk === 'Off' ? { kind: 'off' } : { kind: 'loading' };
      case 'off': return { kind: 'off' };
      case 'saving': return { kind: 'saving' };
      case 'saved': return { kind: 'saved' };
      case 'nothing': return { kind: 'nothingToCompare', title: mode.title, listName: mode.listName };
      case 'home': {
        const onlyNew = me.settings.compareAsk === 'Only for new ratings';
        const counts = new Map<Category, number>();
        for (const u of unratedFinished(entries.data, lists)) {
          if (!st.shown.has(u.id)) counts.set(u.category, (counts.get(u.category) ?? 0) + 1);
        }
        return {
          kind: 'home', afterQueue: mode.afterQueue, onlyNew,
          lists: onlyNew ? [] : compareLists(entries.data, lists),
          unrated: lists.filter((c) => counts.has(c)).map((category) => ({ category, count: counts.get(category)! })),
        };
      }
      case 'run': {
        const run = st.run!, cur = run.session.current;
        if (cur.kind === 'ask') {
          const { a, b } = cur.question;
          return { kind: 'ask', question: cur.question, left: st.flip ? b : a, right: st.flip ? a : b, canBack: run.session.canBack };
        }
        if (cur.outcome.kind !== 'review') return { kind: 'loading' };
        const hasNext = run.kind === 'queue' ? st.queue.length > 0 : run.kind === 'unrated' ? st.unratedList.length > 0 : false;
        return { kind: 'review', changes: cur.outcome.changes, asked: run.session.asked, canBack: run.session.canBack, hasNext };
      }
    }
  }
}
