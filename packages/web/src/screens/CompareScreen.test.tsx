import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry } from '@media-tracker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { makeMe, mockApi, type Handler, type MockResponse } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

interface Setup {
  entries: Entry[];
  queue?: string[];
  ask?: string;
  save?: Handler | MockResponse;
}

function setup({ entries, queue = [], ask = 'Both', save }: Setup) {
  const me = makeMe();
  me.settings = { ...me.settings, compareAsk: ask };
  const rows = entries.map((e) => ({ ...e }));
  const calls = mockApi(me, {
    'GET /api/entries': (_b, url) => ({ body: rows.filter((e) => e.category === url.searchParams.get('category')) }),
    'GET /api/compare/queue': () => ({
      body: { items: queue.map((id) => ({ entryId: id, category: rows.find((e) => e.id === id)?.category ?? 'anime' })) },
    }),
    'DELETE /api/compare/queue/:id': { status: 204 },
    'POST /api/compare/save': save ?? ((b) => {
      const { changes } = b as { changes: { id: string; rating: number }[] };
      const updated = changes.map((c) => {
        const row = rows.find((e) => e.id === c.id)!;
        row.rating = c.rating;
        return { ...row };
      });
      return { body: { updated: updated.length, entries: updated } };
    }),
  });
  const app = renderApp('/compare');
  return { calls, ...app };
}

const anime = () => [
  makeEntry({ id: 'A', title: 'A', rating: 9 }),
  makeEntry({ id: 'B', title: 'B', rating: 8.8 }),
  makeEntry({ id: 'C', title: 'C', rating: 8.5 }),
];

const pair = () => screen.getByRole('group', { name: 'Pick the better one' });
const cardNames = () => within(pair()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
const progress = (text: string) => screen.findByText(text);

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99); // never flip: the question's first item is on the left
});

describe('Compare home', () => {
  it('says comparing is off when Ask is Off', async () => {
    setup({ entries: anime(), ask: 'Off' });
    expect(await screen.findByRole('heading', { name: 'Comparing is off' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('offers lists with 2+ rated titles and the unrated finished titles by list', async () => {
    setup({ entries: [
      ...anime(),
      makeEntry({ id: 'M1', category: 'movies', title: 'M1', rating: 7 }),
      makeEntry({ id: 'M2', category: 'movies', title: 'M2', rating: null }),
      makeEntry({ id: 'M3', category: 'movies', title: 'M3', rating: null }),
    ] });
    const lists = await screen.findByRole('group', { name: 'Lists' });
    expect(screen.getByRole('heading', { name: 'Compare ratings' })).toBeInTheDocument();
    expect(within(lists).getByRole('button', { name: 'Anime (3)' })).toBeInTheDocument();
    expect(within(lists).queryByRole('button', { name: /^Movies/ })).not.toBeInTheDocument();
    const unrated = screen.getByRole('group', { name: 'Unrated lists' });
    expect(within(unrated).getByRole('button', { name: 'Movies (2)' })).toBeInTheDocument();
    expect(screen.getByText(/You only compare things rated within 1 of each other/)).toBeInTheDocument();
  });

  it('Only for new ratings: no list buttons, the only-new text', async () => {
    setup({ entries: anime(), ask: 'Only for new ratings' });
    expect(await screen.findByText('Nothing is waiting. Settings → “Ask to compare” is set to only check new ratings.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Lists' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anime (3)' })).not.toBeInTheDocument();
  });
});

describe('full pass', () => {
  it('goes through Anime, reviews the script’s new ratings, saves them and the list shows them', async () => {
    const { calls, router } = setup({ entries: anime() });
    await userEvent.click(await screen.findByRole('button', { name: 'Anime (3)' }));
    expect(await screen.findByRole('heading', { name: 'Anime' })).toBeInTheDocument();
    expect(screen.getByText('Which one do you think is better? Tap it.')).toBeInTheDocument();
    expect(cardNames()).toEqual(['B, now 8.8', 'A, now 9.0']);
    await userEvent.click(within(pair()).getByRole('button', { name: 'B, now 8.8' }));
    expect(cardNames()).toEqual(['C, now 8.5', 'A, now 9.0']);
    await userEvent.click(within(pair()).getByRole('button', { name: 'C, now 8.5' }));
    expect(cardNames()).toEqual(['C, now 8.5', 'B, now 8.8']);
    await userEvent.click(within(pair()).getByRole('button', { name: 'B, now 8.8' }));

    expect(await screen.findByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
    expect(screen.getByText('Based on your picks (meet in the middle). Nothing is saved until you press Save.')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Rating changes' })).getAllByRole('listitem');
    const read = (li: HTMLElement) => [
      li.querySelector('[data-role="title"]')!.textContent,
      li.querySelector('[data-role="old"]')!.textContent,
      li.querySelector('[data-role="new"]')!.getAttribute('aria-label'),
    ];
    expect(rows.map(read)).toEqual([['B', '8.8', '8.9, up'], ['C', '8.5', '8.8, up'], ['A', '9.0', '8.7, down']]);

    await userEvent.click(screen.getByRole('button', { name: 'Save new ratings' }));
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.getByText('Top 5 and Stats update by themselves.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/compare/save')!;
    expect(post.body).toEqual({ changes: [{ id: 'B', rating: 8.9 }, { id: 'C', rating: 8.8 }, { id: 'A', rating: 8.7 }] });

    await router.navigate('/list/anime');
    await screen.findByText('B');
    for (const r of ['8.9', '8.8', '8.7']) expect(screen.getAllByLabelText(`Rating ${r}`).length).toBeGreaterThan(0);
  });

  it('keys: ArrowLeft answers left, Backspace goes back, s skips; Backspace on the first question does nothing', async () => {
    setup({ entries: anime() });
    await userEvent.click(await screen.findByRole('button', { name: 'Anime (3)' }));
    await progress('Going through 1 of 2 · 0 picks so far');
    fireEvent.keyDown(document, { key: 'Backspace' });
    expect(screen.getByText('Going through 1 of 2 · 0 picks so far')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Back' })).toBeDisabled();

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await progress('Going through 2 of 2 · 1 picks so far');
    expect(cardNames()).toEqual(['C, now 8.5', 'A, now 9.0']); // B was picked over A

    fireEvent.keyDown(document, { key: 'Backspace' });
    await progress('Going through 1 of 2 · 0 picks so far');
    expect(cardNames()).toEqual(['B, now 8.8', 'A, now 9.0']);

    fireEvent.keyDown(document, { key: 's' });
    await progress('Going through 2 of 2 · 1 picks so far');
    expect(cardNames()).toEqual(['C, now 8.5', 'B, now 8.8']); // skipped: B stays under A
  });

  it('moves focus to the new question’s heading after an answer', async () => {
    setup({ entries: anime() });
    await userEvent.click(await screen.findByRole('button', { name: 'Anime (3)' }));
    await userEvent.click(await within(pair()).findByRole('button', { name: 'B, now 8.8' }));
    await progress('Going through 2 of 2 · 1 picks so far');
    expect(screen.getByRole('heading', { name: 'Anime' })).toHaveFocus();
  });

  it('swipes: −80 px picks the left card, +80 px the right; 40 px or mostly vertical does nothing', async () => {
    setup({ entries: anime() });
    await userEvent.click(await screen.findByRole('button', { name: 'Anime (3)' }));
    await progress('Going through 1 of 2 · 0 picks so far');
    const swipe = (dx: number, dy: number) => {
      fireEvent.pointerDown(pair(), { clientX: 200, clientY: 300, pointerId: 1 });
      fireEvent.pointerUp(pair(), { clientX: 200 + dx, clientY: 300 + dy, pointerId: 1 });
    };
    swipe(40, 0);
    swipe(-80, 200);
    expect(screen.getByText('Going through 1 of 2 · 0 picks so far')).toBeInTheDocument();

    swipe(-80, 0);
    await progress('Going through 2 of 2 · 1 picks so far');
    expect(cardNames()).toEqual(['C, now 8.5', 'A, now 9.0']); // left = B

    fireEvent.keyDown(document, { key: 'Backspace' });
    await progress('Going through 1 of 2 · 0 picks so far');
    swipe(80, 0);
    await progress('Going through 2 of 2 · 1 picks so far');
    expect(cardNames()).toEqual(['C, now 8.5', 'B, now 8.8']); // right = A
  });

  it('a failed save shows the toast and keeps the review', async () => {
    setup({ entries: anime(), save: { status: 500, body: { error: 'boom' } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Anime (3)' }));
    for (const name of ['B, now 8.8', 'C, now 8.5', 'B, now 8.8']) {
      await userEvent.click(await within(pair()).findByRole('button', { name }));
    }
    await userEvent.click(await screen.findByRole('button', { name: 'Save new ratings' }));
    expect(await screen.findByText('Couldn\'t save your new ratings. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save new ratings' })).toBeEnabled();
  });
});

describe('the queue', () => {
  const withE2 = () => [
    makeEntry({ id: 'A', title: 'A', rating: 9 }),
    makeEntry({ id: 'e2', title: 'E2', rating: 8.8 }),
    makeEntry({ id: 'B', title: 'B', rating: 8.5 }),
  ];

  it('opens on the queued title; Don’t save leaves it queued', async () => {
    const { calls } = setup({ entries: withE2(), queue: ['e2'] });
    expect(await screen.findByRole('heading', { name: 'Placing E2 (Anime)' })).toBeInTheDocument();
    expect(screen.getByText('New rating · 0 waiting')).toBeInTheDocument();
    await userEvent.click(within(pair()).getByRole('button', { name: 'B, now 8.5' }));
    expect(await screen.findByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Don\'t save' }));
    expect(await screen.findByRole('heading', { name: 'Compare ratings' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/compare/save')).toBe(false);
  });

  it('saves a placed rating with doneEntryId', async () => {
    const { calls } = setup({ entries: withE2(), queue: ['e2'] });
    await screen.findByRole('heading', { name: 'Placing E2 (Anime)' });
    await userEvent.click(within(pair()).getByRole('button', { name: 'B, now 8.5' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save new ratings' }));
    expect(await screen.findByRole('heading', { name: 'Compare ratings' })).toBeInTheDocument();
    expect(screen.getByText(/^New ratings are placed\. Pick a list/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/compare/save')!;
    expect(post.body).toEqual({ changes: [{ id: 'e2', rating: 8.2 }], doneEntryId: 'e2' });
  });

  it('All good → Close takes the title off the queue', async () => {
    const { calls } = setup({ entries: withE2(), queue: ['e2'] });
    await screen.findByRole('heading', { name: 'Placing E2 (Anime)' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('heading', { name: 'All good' })).toBeInTheDocument();
    expect(screen.getByText('Your ratings already match your picks. Nothing changes.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/compare/queue/e2')).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Compare ratings' })).toBeInTheDocument();
  });

  it('Stop on the first of 3 queued titles drops the rest for this visit', async () => {
    setup({ entries: [
      makeEntry({ id: 'A', title: 'A', rating: 9 }),
      makeEntry({ id: 'q1', title: 'Q1', rating: 8.8 }),
      makeEntry({ id: 'q2', title: 'Q2', rating: 8.6 }),
      makeEntry({ id: 'q3', title: 'Q3', rating: 8.4 }),
    ], queue: ['q1', 'q2', 'q3'] });
    expect(await screen.findByRole('heading', { name: 'Placing Q1 (Anime)' })).toBeInTheDocument();
    expect(screen.getByText('New rating · 2 waiting')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    const close = await screen.findByRole('button', { name: /^(Close|Don't save)$/ });
    await userEvent.click(close);
    expect(await screen.findByText(/^New ratings are placed\./)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Placing Q[23]/ })).not.toBeInTheDocument();
  });

  it('Back after Stop shows 0 waiting', async () => {
    setup({ entries: [
      makeEntry({ id: 'A', title: 'A', rating: 9 }),
      makeEntry({ id: 'q1', title: 'Q1', rating: 8.8 }),
      makeEntry({ id: 'B', title: 'B', rating: 8.5 }),
      makeEntry({ id: 'q2', title: 'Q2', rating: 8.6 }),
    ], queue: ['q1', 'q2'] });
    await screen.findByText('New rating · 1 waiting');
    await userEvent.click(within(pair()).getAllByRole('button')[0]!); // Q1 better: one more question
    await screen.findByText('New rating · 1 waiting');
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    await userEvent.click(await screen.findByRole('button', { name: '← Back to last pick' }));
    expect(await screen.findByText('New rating · 0 waiting')).toBeInTheDocument();
  });

  it('skips a queued id missing from the loaded lists', async () => {
    setup({ entries: withE2(), queue: ['gone', 'e2'] });
    expect(await screen.findByRole('heading', { name: 'Placing E2 (Anime)' })).toBeInTheDocument();
    expect(screen.getByText('New rating · 0 waiting')).toBeInTheDocument();
  });
});

describe('unrated', () => {
  it('rates each unrated title of a list, then they drop out of the home counts', async () => {
    setup({ entries: [
      makeEntry({ id: 'M1', category: 'movies', title: 'M1', rating: 7 }),
      makeEntry({ id: 'M2', category: 'movies', title: 'M2', rating: null }),
      makeEntry({ id: 'M3', category: 'movies', title: 'M3', rating: null }),
    ] });
    await userEvent.click(await screen.findByRole('button', { name: 'Movies (2)' }));
    expect(await screen.findByRole('heading', { name: 'Rating M2 (Movies)' })).toBeInTheDocument();
    expect(screen.getByText('Unrated 1 of 2')).toBeInTheDocument();
    expect(cardNames()).toEqual(['M2, not rated yet', 'M1, now 7.0']);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('heading', { name: 'Rating M3 (Movies)' })).toBeInTheDocument();
    expect(screen.getByText('Unrated 2 of 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    expect(await screen.findByRole('heading', { name: 'Compare ratings' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Unrated lists' })).not.toBeInTheDocument();
  });

  it('nothing rated on the list: says so, Next moves on', async () => {
    setup({ entries: [makeEntry({ id: 'M2', category: 'movies', title: 'M2', rating: null })] });
    await userEvent.click(await screen.findByRole('button', { name: 'Movies (1)' }));
    expect(await screen.findByRole('heading', { name: 'M2' })).toBeInTheDocument();
    expect(screen.getByText('Nothing on Movies is rated yet, so there\'s nothing to compare with. Give a couple of things a rating first.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Compare ratings' })).toBeInTheDocument();
  });
});
