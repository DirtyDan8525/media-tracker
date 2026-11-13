import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DETAILS, fakeBackend, makeEntry, makeInfo } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const SAME = ['Frieren', 'Mushishi'];
/** Titles in SAME match exactly; anything else comes back as a different title. */
const lookup = (b: { term: string }) => ({
  body: { info: makeInfo({ title: SAME.includes(b.term) ? b.term : 'Totally Different', sourceId: b.term }) },
});

function setup(entries = [
  makeEntry({ id: 'a', title: 'Frieren' }),
  makeEntry({ id: 'b', title: 'Mushishi' }),
  makeEntry({ id: 'c', title: 'Obscure Thing' }),
], me = makeMe()) {
  return fakeBackend({ me, entries, lookup, details: () => ({ body: { details: DETAILS } }) });
}
const lookups = (calls: { method: string; path: string }[]) => calls.filter((c) => c.path === '/api/lookup').length;
const row = () => screen.getByRole('group', { name: 'Fill in details' });
const tick = (ms = 1500) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('Settings: Fill in details', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });
  const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });

  it('idle with pending titles: says how many wait and offers Start (no progress yet)', async () => {
    const { calls } = setup();
    renderApp('/settings');
    await screen.findByRole('group', { name: 'Fill in details' });
    expect(await within(row()).findByText('3 titles still need details')).toBeInTheDocument();
    expect(within(row()).getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(lookups(calls)).toBe(0);
  });

  it('Start runs one title now and one every 1.5 s; the bar and the text follow, needs-review is counted', async () => {
    const { calls } = setup();
    renderApp('/settings');
    await user().click(await within(await screen.findByRole('group', { name: 'Fill in details' })).findByRole('button', { name: 'Start' }));

    await waitFor(() => expect(within(row()).getByText('1 of 3')).toBeInTheDocument());
    const bar = within(row()).getByRole('progressbar', { name: 'Fill in details progress' });
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(lookups(calls)).toBe(1);
    expect(within(row()).getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    await tick();
    await waitFor(() => expect(within(row()).getByText('2 of 3')).toBeInTheDocument());
    expect(lookups(calls)).toBe(2);
    await tick();
    await waitFor(() => expect(within(row()).queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument());
    expect(within(row()).getByText(/All details filled in/)).toBeInTheDocument();
    expect(within(row()).getByText(/1 needs you to pick the right match/)).toBeInTheDocument();
    // Only the four detail fields and detailsState are ever patched.
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/entries/a')!.body as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(['detailsState', 'lengthLabel', 'origin', 'releaseDate', 'synopsis']);
  });

  it('shows "N of M · K need you to pick the right match" while running', async () => {
    setup([makeEntry({ id: 'c', title: 'Obscure Thing' }), makeEntry({ id: 'a', title: 'Frieren' }), makeEntry({ id: 'b', title: 'Mushishi' })]);
    renderApp('/settings');
    await user().click(await within(await screen.findByRole('group', { name: 'Fill in details' })).findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(within(row()).getByText('1 of 3 · 1 needs you to pick the right match')).toBeInTheDocument());
  });

  it('uses the plural wording when several need a pick', async () => {
    setup([
      makeEntry({ id: 'x', title: 'Odd 1', detailsState: 'needs_review' }),
      makeEntry({ id: 'y', title: 'Odd 2', detailsState: 'needs_review' }),
      makeEntry({ id: 'a', title: 'Frieren' }),
    ]);
    renderApp('/settings');
    expect(await within(await screen.findByRole('group', { name: 'Fill in details' })).findByText(/2 need you to pick the right match/)).toBeInTheDocument();
  });

  it('Pause stops after the current title; Start picks up the remaining ones', async () => {
    const { calls } = setup();
    renderApp('/settings');
    const u = user();
    await u.click(await within(await screen.findByRole('group', { name: 'Fill in details' })).findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(within(row()).getByText('1 of 3')).toBeInTheDocument());
    await u.click(within(row()).getByRole('button', { name: 'Pause' }));
    expect(within(row()).getByRole('button', { name: 'Start' })).toBeInTheDocument();
    await tick(6000);
    expect(lookups(calls)).toBe(1);

    await u.click(within(row()).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(lookups(calls)).toBe(2)); // 'a' is no longer pending: resumes with the rest
    await waitFor(() => expect(within(row()).getByText('1 of 2')).toBeInTheDocument());
  });

  it('only fills titles on lists that are switched on', async () => {
    const { calls } = setup([
      makeEntry({ id: 'a', title: 'Frieren' }),
      makeEntry({ id: 'k', category: 'books', title: 'Mushishi' }),
    ], makeMe({}, { books: false }));
    renderApp('/settings');
    await user().click(await within(await screen.findByRole('group', { name: 'Fill in details' })).findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(within(row()).getByText(/All details filled in/)).toBeInTheDocument());
    expect(calls.map((c) => c.path)).not.toContain('/api/entries?category=books');
    expect(lookups(calls)).toBe(1);
  });

  it('keeps running when you move to another screen and back', async () => {
    const { calls } = setup();
    const { router } = renderApp('/settings');
    const u = user();
    await u.click(await within(await screen.findByRole('group', { name: 'Fill in details' })).findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(lookups(calls)).toBe(1));

    await act(async () => { await router.navigate('/more'); });
    await tick();
    expect(lookups(calls)).toBe(2);
    await act(async () => { await router.navigate('/settings'); });
    await waitFor(() => expect(within(row()).getByRole('button', { name: 'Pause' })).toBeInTheDocument());
    await tick();
    await waitFor(() => expect(within(row()).getByText(/All details filled in/)).toBeInTheDocument());
    expect(lookups(calls)).toBe(3);
  });

  it('shows the filled details on the entry afterwards (caches updated)', async () => {
    setup([makeEntry({ id: 'a', title: 'Frieren' })]);
    const { router } = renderApp('/settings');
    await user().click(await within(await screen.findByRole('group', { name: 'Fill in details' })).findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(within(row()).getByText(/All details filled in/)).toBeInTheDocument());
    await act(async () => { await router.navigate('/entry/a'); });
    expect(within(await screen.findByRole('region', { name: 'Synopsis' })).getByText('An elf outlives her party.')).toBeInTheDocument();
  });
});
