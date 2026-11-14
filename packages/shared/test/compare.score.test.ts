import { describe, expect, test } from 'vitest';
import {
  COMPARE_ROOM, COMPARE_STYLE, betterKey, pairKey, placeScore, rescore,
  type CompareItem, type CompareRoom, type CompareStyle, type RatingChange,
} from '../src/index';
import { rng } from './helpers/prng';
import { loadScriptCompare, scriptPk, type ScriptChange, type ScriptCompare, type ScriptItem } from './helpers/scriptCompare';

const it_ = (title: string, rating: number | null, row: number): CompareItem =>
  ({ id: `${row}|${title}`, title, rating, cover: '', square: false });
const A = it_('A', 8, 2), B = it_('B', 9, 3), C = it_('C', 7, 4), D = it_('D', 8.25, 5);

// Port items use id = `${row}|${title}`, so the script's row comes back out of the id.
const toScript = (x: CompareItem): ScriptItem => {
  const s: ScriptItem = { row: Number(x.id.split('|')[0]), title: x.title, rating: x.rating, cover: x.cover, square: x.square };
  if (x.isNew !== undefined) s.isNew = x.isNew;
  return s;
};
const fromScript = (c: ScriptChange): RatingChange =>
  ({ id: `${c.row}|${c.title}`, title: c.title, old: c.old === '—' ? null : c.old, isNew: c.isNew, rating: c.rating });

const oracles = new Map<string, ScriptCompare>();
const oracle = (style: CompareStyle, room: CompareRoom) => {
  const k = style + '/' + room;
  if (!oracles.has(k)) oracles.set(k, loadScriptCompare({ style, room, window: 1 }));
  return oracles.get(k)!;
};
const scriptRescore = (order: CompareItem[], better: Set<string>, ties: Set<string>, style: CompareStyle) =>
  // Port keys and script keys are the same strings because port ids are `row|title`.
  oracle(style, 'Use in-between scores').rescore(order.map(toScript), better, ties).map(fromScript);
const scriptPlace = (order: CompareItem[], idx: number, tie: CompareItem | null, room: CompareRoom) => {
  const r = oracle('Meet in the middle', room).placeScore(order.map(toScript), idx, tie && toScript(tie));
  return r === null ? null : r.map(fromScript);
};

describe('keys', () => {
  test('pairKey sorts the ids; betterKey is winner>loser; both match the script', () => {
    expect(pairKey(B, A)).toBe('2|A~3|B');
    expect(pairKey(A, B)).toBe(scriptPk(toScript(B), toScript(A)));
    expect(betterKey(A, B)).toBe('2|A>3|B');
  });
});

describe('rescore', () => {
  const golden: [string, CompareItem[], Set<string>, Set<string>, CompareStyle, RatingChange[]][] = [
    ['meet in the middle: smallest moves, 0.1 apart', [A, B, C], new Set([betterKey(A, B)]), new Set(), 'Meet in the middle', [
      { id: '2|A', title: 'A', old: 8, isNew: false, rating: 8.6 }, { id: '3|B', title: 'B', old: 9, isNew: false, rating: 8.5 }]],
    ['ties share the average (meet in the middle)', [A, B, C], new Set(), new Set([pairKey(A, B)]), 'Meet in the middle', [
      { id: '2|A', title: 'A', old: 8, isNew: false, rating: 8.5 }, { id: '3|B', title: 'B', old: 9, isNew: false, rating: 8.5 }]],
    ['ties share the average (swap)', [A, B, C], new Set(), new Set([pairKey(A, B)]), 'Swap the numbers', [
      { id: '2|A', title: 'A', old: 8, isNew: false, rating: 8.5 }, { id: '3|B', title: 'B', old: 9, isNew: false, rating: 8.5 }]],
  ];
  test.each(golden)('%s', (_n, order, better, ties, style, want) => {
    expect(rescore(order, better, ties, style)).toEqual(want);
    expect(scriptRescore(order, better, ties, style)).toEqual(want); // the golden value is the script's
  });

  test('hundredths when any score has two decimals', () => {
    const better = new Set([betterKey(A, D), betterKey(D, B)]);
    expect(rescore([A, D, B], better, new Set(), 'Meet in the middle').map((c) => c.rating)).toEqual([8.52, 8.42, 8.32]);
    expect(scriptRescore([A, D, B], better, new Set(), 'Meet in the middle').map((c) => c.rating)).toEqual([8.52, 8.42, 8.32]);
  });

  test('swap the numbers', () => {
    const better = new Set([betterKey(A, B)]);
    expect(rescore([A, B, C], better, new Set(), 'Swap the numbers').map((c) => [c.title, c.rating])).toEqual([['A', 9], ['B', 8]]);
    expect(scriptRescore([A, B, C], better, new Set(), 'Swap the numbers').map((c) => [c.title, c.rating])).toEqual([['A', 9], ['B', 8]]);
  });

  test('a new item is always listed, with old null', () => {
    const N = { ...it_('N', 8.5, 9), isNew: true };
    const got = rescore([B, N, A], new Set(), new Set(), 'Meet in the middle');
    expect(got).toEqual([{ id: '9|N', title: 'N', old: null, isNew: true, rating: 8.5 }]);
    expect(scriptRescore([B, N, A], new Set(), new Set(), 'Meet in the middle')).toEqual(got);
  });
});

describe('placeScore', () => {
  const N = { ...it_('N', null, 9), isNew: true };
  const golden: [string, CompareItem[], number, CompareItem | null, CompareRoom, RatingChange[] | null][] = [];
  const add = (name: string, order: CompareItem[], idx: number, tie: CompareItem | null, room: CompareRoom, want: number | null | []) =>
    golden.push([name, order, idx, tie, room, want === null ? null : Array.isArray(want) ? []
      : [{ id: order[idx].id, title: order[idx].title, old: order[idx].isNew ? null : order[idx].rating, isNew: !!order[idx].isNew, rating: want }]]);
  add('no whole-tenth room: Use in-between scores', [it_('H', 9.5, 2), N, it_('L', 9.4, 3)], 1, null, 'Use in-between scores', 9.45);
  add('no whole-tenth room: Give the same score', [it_('H', 9.5, 2), N, it_('L', 9.4, 3)], 1, null, 'Give the same score', 9.5);
  for (const room of ['Use in-between scores', 'Give the same score'] as const) {
    add(`top of list, below 9.5 (${room})`, [N, it_('L', 9.5, 3)], 0, null, room, 9.7);
    add(`bottom of list, above 9.4 (${room})`, [it_('H', 9.4, 2), N], 1, null, room, 9.1);
    add(`between 9.0 and 8.0 (${room})`, [it_('H', 9, 2), N, it_('L', 8, 3)], 1, null, room, 8.5);
    add(`gap < 0.02 between 9.41 and 9.4 (${room})`, [it_('H', 9.41, 2), N, it_('L', 9.4, 3)], 1, null, room, 9.41);
    add(`existing rating already fits (${room})`, [it_('H', 9, 2), it_('M', 8.7, 4), it_('L', 8, 3)], 1, null, room, []);
    add(`tie given (${room})`, [it_('H', 9, 2), N, it_('L', 8, 3)], 1, it_('L', 8, 3), room, 8);
  }
  add('Push others down', [it_('H', 9, 2), N, it_('L', 8, 3)], 1, null, 'Push others down', null);
  test.each(golden)('%s', (_n, order, idx, tie, room, want) => {
    expect(placeScore(order, idx, tie, room)).toEqual(want);
    expect(scriptPlace(order, idx, tie, room)).toEqual(want); // the golden value is the script's
  });
});

// ---------- randomized differential test against the script ----------
function randomCase(seed: number) {
  const r = rng(seed);
  const n = 2 + Math.floor(r() * 24); // 2–25
  const hundredths = r() < 0.25;
  const rand = () => hundredths ? Math.round(100 + r() * 900) / 100 : Math.round(10 + r() * 90) / 10;
  const items: CompareItem[] = [];
  for (let i = 0; i < n; i++) {
    const rating = i > 0 && r() < 0.2 ? items[i - 1].rating : rand();
    const x = it_(`T${i}${r() < 0.1 ? ' ~x|y' : ''}`, rating, i + 2);
    if (r() < 0.1) x.isNew = true;
    items.push(x);
  }
  // The order the person chose: a random permutation.
  const order = items.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const better = new Set<string>(), ties = new Set<string>();
  for (let i = 0; i < n - 1; i++) {
    const x = r();
    if (x < 0.4) better.add(betterKey(order[i], order[i + 1]));
    else if (x < 0.55) ties.add(pairKey(order[i], order[i + 1]));
    else if (x < 0.6) better.add(betterKey(order[i + 1], order[i])); // a stale opposite pick
  }
  // placeScore: one item being placed (new or not), the rest keep their ratings.
  const idx = Math.floor(r() * n);
  const placing = order.map((x) => ({ ...x, isNew: false }));
  if (r() < 0.5) placing[idx] = { ...placing[idx], isNew: true, rating: r() < 0.5 ? null : placing[idx].rating };
  // A tie is always another, rated item (the script only offers rated items as the other side).
  const j = Math.floor(r() * (n - 1));
  const tie = r() < 0.3 ? placing[j >= idx ? j + 1 : j] : null;
  return { order, better, ties, placing, idx, tie };
}

describe('matches the script on 500 random orders per style and room', () => {
  const cases = Array.from({ length: 500 }, (_, s) => randomCase(s + 1));
  test.each(COMPARE_STYLE.map((s) => [s]))('rescore: %s', (style) => {
    for (const c of cases) {
      expect(rescore(c.order, c.better, c.ties, style)).toEqual(scriptRescore(c.order, c.better, c.ties, style));
    }
  });
  test.each(COMPARE_ROOM.map((r) => [r]))('placeScore: %s', (room) => {
    for (const c of cases) {
      expect(placeScore(c.placing, c.idx, c.tie, room)).toEqual(scriptPlace(c.placing, c.idx, c.tie, room));
    }
  });
});
