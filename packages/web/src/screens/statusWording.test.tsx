import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

const CASES = [
  { category: 'games', list: 'Games', plan: 'Plan to play', active: 'Playing', again: 'Replaying' },
  { category: 'books', list: 'Books', plan: 'Plan to read', active: 'Reading', again: 'Rereading' },
] as const;

describe.each(CASES)('status wording on $list', ({ category, plan, active, again }) => {
  beforeEach(() => setViewportWidth(1200));

  it('filter shows the list wording while the URL and filtering use the stored value', async () => {
    fakeBackend({ entries: [
      makeEntry({ category, title: 'Alpha', status: 'Plan to watch' }),
      makeEntry({ category, title: 'Beta', status: 'Watching / In Progress' }),
    ] });
    const { router } = renderApp(`/list/${category}`);
    await screen.findByText('Alpha');
    const select = screen.getByRole('combobox', { name: 'Status' });
    expect(within(select).getByRole('option', { name: `Status: ${plan}` })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: `Status: ${active}` })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: `Status: ${again}` })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /watch/i })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, `Status: ${plan}`);
    await waitFor(() => expect(router.state.location.search).toBe('?status=Plan+to+watch'));
    expect(screen.getByText(plan, { selector: '.status-pill' })).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('a stored-value URL filter still works', async () => {
    fakeBackend({ entries: [
      makeEntry({ category, title: 'Alpha', status: 'Plan to watch' }),
      makeEntry({ category, title: 'Beta', status: 'Completed' }),
    ] });
    renderApp(`/list/${category}?status=Plan+to+watch`);
    await screen.findByText('Alpha');
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('Plan to watch');
  });

  it('entry detail shows the wording and saves the stored value', async () => {
    const { calls } = fakeBackend({ entries: [makeEntry({ id: 'x1', category, title: 'Alpha', status: 'Plan to watch' })] });
    renderApp('/entry/x1');
    const select = await screen.findByLabelText('Status');
    expect(within(select).getByRole('option', { name: plan })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /watch/i })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, active);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && (c.body as { status?: string }).status === 'Watching / In Progress')).toBe(true));
  });
});

describe('status wording on the phone Filters sheet', () => {
  beforeEach(() => setViewportWidth(390));

  it.each(CASES)('$list chips and the Plan to watch switch use the list wording', async ({ category, plan, active, again }) => {
    fakeBackend({ entries: [makeEntry({ category, title: 'Alpha', status: 'Plan to watch' })] });
    renderApp(`/list/${category}`);
    await screen.findByText('Alpha');
    expect(screen.getByRole('switch', { name: plan })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    expect(within(sheet).getByRole('button', { name: active })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: again })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /watch/i })).not.toBeInTheDocument();
  });
});

describe('status wording on anime', () => {
  beforeEach(() => setViewportWidth(1200));

  it('keeps the original wording', async () => {
    fakeBackend({ entries: [makeEntry({ title: 'Alpha', status: 'Plan to watch' })] });
    renderApp('/list/anime');
    await screen.findByText('Alpha');
    const select = screen.getByRole('combobox', { name: 'Status' });
    expect(within(select).getByRole('option', { name: 'Status: Plan to watch' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Status: Watching / In Progress' })).toBeInTheDocument();
  });
});
