import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { dragTarget, moveId, moveStep, planRows, readPlanView, writePlanView } from './plan';

const p = (id: string, planOrder: number | null, createdAt = '2026-01-01T00:00:00Z') =>
  makeEntry({ id, title: id, status: 'Plan to watch', planOrder, createdAt });

describe('planRows', () => {
  it('keeps only planned titles, in plan order; unplaced ones go last by date then id', () => {
    const rows = [
      p('c', 3), makeEntry({ id: 'done', status: 'Completed', planOrder: 1 }), p('x', null, '2026-02-01T00:00:00Z'),
      p('a', 1), p('w', null, '2026-01-15T00:00:00Z'), p('b', 2),
    ];
    expect(planRows(rows).map((e) => e.id)).toEqual(['a', 'b', 'c', 'w', 'x']);
  });
  it('reads rows cached before Phase 5 (no planOrder at all) as unplaced', () => {
    const old = makeEntry({ id: 'o', status: 'Plan to watch' });
    delete (old as { planOrder?: unknown }).planOrder;
    expect(planRows([old, p('a', 1)]).map((e) => e.id)).toEqual(['a', 'o']);
  });
});

describe('moving', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moveId puts an id at an index', () => {
    expect(moveId(ids, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveId(ids, 'b', 1)).toEqual(ids);
    expect(moveId(ids, 'zz', 1)).toEqual(ids);
  });
  it('moveStep: top, up, down, and the ends stay put', () => {
    expect(moveStep(ids, 'c', 'top')).toEqual(['c', 'a', 'b', 'd']);
    expect(moveStep(ids, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveStep(ids, 'c', 'down')).toEqual(['a', 'b', 'd', 'c']);
    expect(moveStep(ids, 'a', 'up')).toEqual(ids);
    expect(moveStep(ids, 'd', 'down')).toEqual(ids);
  });
});

describe('dragTarget', () => {
  it('rounds the drag distance to whole rows and clamps to the list', () => {
    expect(dragTarget(2, 0, 80, 5)).toBe(2);
    expect(dragTarget(2, 39, 80, 5)).toBe(2);
    expect(dragTarget(2, 41, 80, 5)).toBe(3);
    expect(dragTarget(2, -90, 80, 5)).toBe(1);
    expect(dragTarget(2, 9999, 80, 5)).toBe(4);
    expect(dragTarget(2, -9999, 80, 5)).toBe(0);
    expect(dragTarget(0, 50, 0, 5)).toBe(0);
  });
});

describe('remembering the switch per list', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips per category', () => {
    expect(readPlanView('anime')).toBe(false);
    writePlanView('anime', true);
    expect(readPlanView('anime')).toBe(true);
    expect(readPlanView('games')).toBe(false);
    writePlanView('anime', false);
    expect(readPlanView('anime')).toBe(false);
  });
  it('survives a storage that throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readPlanView('anime')).toBe(false);
    expect(() => writePlanView('anime', true)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
