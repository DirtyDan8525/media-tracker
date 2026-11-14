import { describe, expect, it, vi } from 'vitest';
import { DETAILS, makeEntry, makeInfo } from '../test/fakeBackend';
import { backfillOne, type BackfillDeps } from './backfill';

function deps(details: BackfillDeps['details']) {
  const patch = vi.fn(async () => ({}));
  const d: BackfillDeps = {
    lookup: async (q) => ({ info: makeInfo({ title: q.term, sourceId: '1' }) }),
    details,
    patch,
  };
  return { d, patch };
}

describe('backfillOne: source failure vs nothing found (R51)', () => {
  const entry = makeEntry({ id: 'a', title: 'Frieren' });

  it('a failed details call is skipped with no PATCH, so a later run retries', async () => {
    const { d, patch } = deps(async () => ({ details: null, failed: true }));
    expect(await backfillOne(entry, d)).toBe('skipped');
    expect(patch).not.toHaveBeenCalled();
  });

  it('a genuine null after a confirmed match is still filled (nothing to add)', async () => {
    const { d, patch } = deps(async () => ({ details: null }));
    expect(await backfillOne(entry, d)).toBe('filled');
    expect(patch).toHaveBeenCalledWith('a', { detailsState: 'filled' });
  });

  it('real details are applied and the entry is filled', async () => {
    const { d, patch } = deps(async () => ({ details: DETAILS }));
    expect(await backfillOne(entry, d)).toBe('filled');
    expect(patch).toHaveBeenCalledWith('a', expect.objectContaining({ detailsState: 'filled', synopsis: DETAILS.synopsis }));
  });

  it('a rejected details call is skipped with no PATCH', async () => {
    const { d, patch } = deps(async () => { throw new Error('offline'); });
    expect(await backfillOne(entry, d)).toBe('skipped');
    expect(patch).not.toHaveBeenCalled();
  });
});
