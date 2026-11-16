import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DEFAULT_TIERS, priorFromScore, tierFor, tierRange, type Entry, type SavePayload, type Season, type SetItem,
} from '@media-tracker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { makeMe, mockApi, type Handler, type MockResponse } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setCompareEnabled } from '../test/flags';

beforeEach(() => setCompareEnabled(true)); // these exercise Compare, which is hidden in the real build

/** A rated entry as the Worker stores it after the backfill: tier from the number, prior = strength. */
function rated(id: string, rating: number, over: Partial<Entry> = {}): Entry {
  const tier = tierFor(rating, DEFAULT_TIERS);
  const p = priorFromScore(rating, tierRange(DEFAULT_TIERS, tier));
  return makeEntry({ id, title: id, rating, tier, priorMean: p, strength: p, ...over });
}
const unrated = (id: string, over: Partial<Entry> = {}) => makeEntry({ id, title: id, rating: null, ...over });

const setItem = (e: Pick<Entry, 'id' | 'title' | 'rating' | 'tier' | 'priorMean' | 'strength' | 'scoreLocked' | 'coverUrl' | 'status'>): SetItem => ({
  id: e.id, title: e.title, rating: e.rating, tier: e.tier, priorMean: e.priorMean, strength: e.strength,
  scoreLocked: e.scoreLocked, cover: e.coverUrl, square: false, status: e.status,
});

interface Setup {
  entries: Entry[];
  seasons?: Season[];
  queue?: string[];
  ask?: string;
  save?: Handler | MockResponse;
  tabs?: Record<string, boolean>;
  path?: string;
  /** Answers GET /api/ratings/:set instead of the rows (the n-th call is `n`, from 1). */
  ratingSet?: (set: string, n: number) => MockResponse;
}

function setup({ entries, seasons = [], queue = [], ask = 'Both', save, tabs = {}, path = '/compare', ratingSet }: Setup) {
  const me = makeMe({}, tabs);
  me.settings = { ...me.settings, compareAsk: ask };
  const rows = entries.map((e) => ({ ...e }));
  let setLoads = 0;
  const calls = mockApi(me, {
    'GET /api/entries': (_b, url) => ({ body: rows.filter((e) => e.category === url.searchParams.get('category')) }),
    'GET /api/compare/queue': () => ({
      body: { items: queue.map((id) => ({ entryId: id, category: rows.find((e) => e.id === id)?.category ?? 'anime' })) },
    }),
    'DELETE /api/compare/queue/:id': { status: 204 },
    'GET /api/ratings/:set': (_b, _u, p) => {
      if (ratingSet) return ratingSet(p.set!, ++setLoads);
      if (p.set === 'anime_seasons') {
        return { body: { items: seasons.map((s) => setItem({ ...s, title: `Show · ${s.label}`, coverUrl: '', status: null })), comparisons: [] } };
      }
      return { body: { items: rows.filter((e) => e.category === p.set).map(setItem), comparisons: [] } };
    },
    'POST /api/ratings/:set/save': save ?? { body: { items: [], entries: [] } },
  });
  const app = renderApp(path);
  return { calls, ...app };
}

const lovedAnime = () => [
  rated('Akira', 9.8), rated('Bebop', 9.5), rated('Clannad', 9.4),
  rated('Dorohedoro', 8.0), rated('Erased', 7.9), rated('FLCL', 6.5),
];

const pair = () => screen.getByRole('group', { name: 'Pick the better one' });
const cardNames = () => within(pair()).getAllByRole('button', { name: /, now / }).map((b) => b.getAttribute('aria-label'));
const saves = (calls: { method: string; path: string; body: unknown }[], set = 'anime') =>
  calls.filter((c) => c.method === 'POST' && c.path === `/api/ratings/${set}/save`).map((c) => c.body as SavePayload);

/** A review row as read aloud: title, tier change (if any), old rating, new rating badge, direction. */
const readRow = (li: HTMLElement) => [
  li.querySelector('[data-role="title"]')!.textContent,
  li.querySelector('[data-role="tiers"]')?.textContent ?? null,
  li.querySelector('[data-role="old"]')!.textContent,
  within(li.querySelector<HTMLElement>('[data-role="new"]')!).getByLabelText(/^Rating /).getAttribute('aria-label'),
  within(li).queryByText('up') ? 'up' : within(li).queryByText('down') ? 'down' : null,
];
const reviewRows = () => within(screen.getByRole('list', { name: 'Rating changes' })).getAllByRole('listitem').map(readRow);

async function openTier(list: string, tier: string) {
  await userEvent.click(await screen.findByRole('button', { name: list }));
  await userEvent.click(await within(await screen.findByRole('group', { name: 'Tiers' })).findByRole('button', { name: tier }));
}

/** Fix my ratings on Anime · Loved: Bebop > Clannad, then Stop: the review. */
async function fixToReview() {
  await openTier('Anime (6)', 'Loved 3 titles');
  await userEvent.click(await within(pair()).findByRole('button', { name: 'Bebop, now 9.5' }));
  await screen.findByText('Pick 2');
  await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
  await screen.findByRole('heading', { name: 'New ratings' });
}
const FIX_ROWS = [['Bebop', null, '9.5', 'Rating 9.6', 'up'], ['Clannad', null, '9.4', 'Rating 9.3', 'down']];
const FIX_PAYLOAD: SavePayload = { picks: [{ winnerId: 'Bebop', loserId: 'Clannad', isTie: false, undone: false }], moves: [], done: [] };

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99); // never flip: the question's first title is on the left
});

describe('Fix my ratings: home', () => {
  it('home: lists with ≥2 rated, season tabs when on, tier chips with counts; Off and Only-for-new texts', async () => {
    setup({
      entries: [
        ...lovedAnime(),
        rated('M1', 7, { category: 'movies' }),
        unrated('M2', { category: 'movies' }),
        unrated('M3', { category: 'movies' }),
        unrated('W', { status: 'Watching / In Progress' }), // not finished: not offered
      ],
      seasons: [
        { id: 's1', entryId: 'Akira', label: 'S1', rating: 9.2, notes: '', tier: 3, priorMean: 0, strength: 0, scoreLocked: false },
        { id: 's2', entryId: 'Akira', label: 'S2', rating: 8, notes: '', tier: 2, priorMean: 0, strength: 0, scoreLocked: false },
      ],
      tabs: { tvSeasons: false },
    });
    expect(await screen.findByText('Pick a list. The app asks about the two closest titles in a tier; stop any time.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fix my ratings' })).toBeInTheDocument();
    const lists = screen.getByRole('group', { name: 'Lists' });
    expect(within(lists).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Anime (6)', 'Anime Seasons']);

    expect(screen.getByRole('heading', { name: 'Rate finished things with no score' })).toBeInTheDocument();
    const unratedGroup = screen.getByRole('group', { name: 'Unrated lists' });
    expect(within(unratedGroup).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Movies (2)']);

    await userEvent.click(within(lists).getByRole('button', { name: 'Anime (6)' }));
    const tiers = await screen.findByRole('group', { name: 'Tiers' });
    expect(within(tiers).getAllByRole('button').map((b) => b.textContent)).toEqual(['All tiers', 'Loved 3', 'Liked 2', 'Fine 1', 'Didn\'t like 0']);
    expect(within(tiers).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([null, 'Loved 3 titles', 'Liked 2 titles', 'Fine 1 title', 'Didn\'t like 0 titles']);
    expect(within(lists).getByRole('button', { name: 'Anime (6)' })).toHaveAttribute('aria-pressed', 'true');

    // a season tab has no count until opened; then its own tier counts
    await userEvent.click(within(lists).getByRole('button', { name: 'Anime Seasons' }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Tiers' })).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['All tiers', 'Loved 1', 'Liked 1', 'Fine 0', 'Didn\'t like 0']));
  });

  it('home: Off says comparing is off', async () => {
    setup({ entries: lovedAnime(), ask: 'Off' });
    expect(await screen.findByRole('heading', { name: 'Comparing is off' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings/appearance');
  });

  it('home: Only for new ratings offers no lists, with its own text', async () => {
    setup({ entries: lovedAnime(), ask: 'Only for new ratings' });
    expect(await screen.findByText('Nothing is waiting. Settings → “Ask to compare” is set to only check new ratings.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Lists' })).not.toBeInTheDocument();
  });
});

describe('Fix my ratings: a session', () => {
  it('fix: asks the two closest titles in the chosen tier; About the same, Skip, Stop, Back; review shows old → new; Save posts the payload', async () => {
    const { calls } = setup({ entries: lovedAnime() });
    await openTier('Anime (6)', 'Loved 3 titles');
    expect(await screen.findByRole('heading', { name: 'Fix my ratings' })).toBeInTheDocument();
    expect(screen.getByText('Anime · Loved')).toBeInTheDocument();
    expect(screen.getByText('Which do you like more? Tap it.')).toBeInTheDocument();
    expect(cardNames()).toEqual(['Bebop, now 9.5', 'Clannad, now 9.4']);
    expect(screen.getByText('Pick 1')).toBeInTheDocument();

    await userEvent.click(within(pair()).getByRole('button', { name: 'Bebop, now 9.5' }));
    await screen.findByText('Pick 2');
    expect(cardNames()).toEqual(['Akira, now 9.8', 'Bebop, now 9.6']);
    await userEvent.click(screen.getByRole('button', { name: 'About the same' }));
    await screen.findByText('Pick 3');
    await userEvent.click(screen.getByRole('button', { name: '← Back' }));
    await screen.findByText('Pick 2');
    expect(cardNames()).toEqual(['Akira, now 9.8', 'Bebop, now 9.6']);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(cardNames()).toEqual(['Bebop, now 9.6', 'Clannad, now 9.3']));
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));

    expect(await screen.findByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
    expect(screen.getByText('Based on your picks. Nothing is saved until you press Save.')).toBeInTheDocument();
    expect(reviewRows()).toEqual(FIX_ROWS);
    expect(saves(calls)).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Save new ratings' }));
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeInTheDocument();
    expect(saves(calls)).toEqual([{
      picks: [
        { winnerId: 'Bebop', loserId: 'Clannad', isTie: false, undone: false },
        { winnerId: 'Akira', loserId: 'Bebop', isTie: true, undone: true },
      ],
      moves: [],
      done: [],
    }]);
  });

  it('Belongs in another tier moves the title, the next question changes, and the review shows the tier change', async () => {
    const { calls } = setup({ entries: lovedAnime() });
    await openTier('Anime (6)', 'Loved 3 titles');
    await screen.findByText('Pick 1');
    const move = screen.getByRole('button', { name: 'Belongs in another tier: Clannad' });
    expect(move).toHaveAttribute('aria-expanded', 'false');
    expect(move.closest('button.pick')).toBeNull(); // a sibling of the card, never inside it
    await userEvent.click(move);
    const menu = screen.getByRole('menu', { name: 'Move Clannad to' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.getAttribute('aria-label'))).toEqual(['Liked · 7.5–8.9', 'Fine · 6–7.4', 'Didn\'t like · 0–5.9']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Liked · 7.5–8.9' }));

    await waitFor(() => expect(cardNames()).toEqual(['Akira, now 9.8', 'Bebop, now 9.5']));
    expect(screen.getByText('0 of 1 neighbours checked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    expect(await screen.findByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
    expect(reviewRows()).toEqual([['Clannad', 'Loved → Liked', '9.4', 'Rating 8.9', 'down']]);
    await userEvent.click(screen.getByRole('button', { name: 'Save new ratings' }));
    await screen.findByRole('heading', { name: 'Saved' });
    expect(saves(calls)).toEqual([{ picks: [], moves: [{ id: 'Clannad', tier: 2 }], done: [] }]);
  });

  it('the settledness bar shows checked of total and grows after a pick between neighbours', async () => {
    setup({ entries: lovedAnime() });
    await openTier('Anime (6)', 'Loved 3 titles');
    const bar = await screen.findByRole('progressbar', { name: 'Neighbours checked' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    expect(screen.getByText('0 of 2 neighbours checked')).toBeInTheDocument();
    await userEvent.click(within(pair()).getByRole('button', { name: 'Bebop, now 9.5' }));
    expect(await screen.findByText('1 of 2 neighbours checked')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Neighbours checked' })).toHaveAttribute('aria-valuenow', '1');
  });

  it('nothing left to ask: a one-title tier ends at once with the friendly line', async () => {
    const { calls } = setup({ entries: lovedAnime() });
    await openTier('Anime (6)', 'Fine 1 title');
    expect(await screen.findByText('Nothing left to ask in Anime · Fine. Your order is as settled as your picks make it.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Pick the better one' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('group', { name: 'Lists' })).toBeInTheDocument();
    expect(saves(calls)).toEqual([]);
  });

  it('a failed save keeps the review and shows the toast; Save again posts the same payload', async () => {
    let fail = true;
    const { calls } = setup({ entries: lovedAnime(), save: () => (fail ? { status: 500, body: { error: 'boom' } } : { body: { items: [], entries: [] } }) });
    await fixToReview();
    await userEvent.click(screen.getByRole('button', { name: 'Save new ratings' }));
    expect(await screen.findByText('Couldn\'t save your new ratings. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
    expect(reviewRows()).toEqual(FIX_ROWS);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Save new ratings' }));
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeInTheDocument();
    expect(saves(calls)).toEqual([FIX_PAYLOAD, FIX_PAYLOAD]);
  });

  it('a save that still conflicts after the retry says so, with Reload', async () => {
    const { calls } = setup({ entries: lovedAnime(), save: { status: 409, body: { error: 'conflict' } } });
    await fixToReview();
    await userEvent.click(screen.getByRole('button', { name: 'Save new ratings' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your ratings changed elsewhere. Reload and try again.');
    expect(saves(calls)).toHaveLength(2); // the one automatic retry
    expect(reviewRows()).toEqual(FIX_ROWS);
    const before = calls.length;
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload' }));
    expect(await screen.findByRole('group', { name: 'Lists' })).toBeInTheDocument();
    await waitFor(() => expect(calls.slice(before).some((c) => c.method === 'GET' && c.path === '/api/entries?category=anime')).toBe(true));
  });

  it('keys and swipe still answer (←, →, ↓, S, Backspace; ±80 px)', async () => {
    setup({ entries: lovedAnime() });
    await openTier('Anime (6)', 'Loved 3 titles');
    await screen.findByText('Pick 1');
    fireEvent.keyDown(document, { key: 'Backspace' }); // nothing to go back to
    expect(screen.getByText('Pick 1')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'ArrowLeft' }); // Bebop
    await screen.findByText('Pick 2');
    expect(cardNames()).toEqual(['Akira, now 9.8', 'Bebop, now 9.6']);
    fireEvent.keyDown(document, { key: 'Backspace' });
    await screen.findByText('Pick 1');
    expect(cardNames()).toEqual(['Bebop, now 9.5', 'Clannad, now 9.4']);
    fireEvent.keyDown(document, { key: 'ArrowRight' }); // Clannad
    await screen.findByText('Pick 2');
    fireEvent.keyDown(document, { key: 'Backspace' });
    await screen.findByText('Pick 1');
    fireEvent.keyDown(document, { key: 'ArrowDown' }); // About the same
    await screen.findByText('Pick 2');
    fireEvent.keyDown(document, { key: 'Backspace' });
    await screen.findByText('Pick 1');
    fireEvent.keyDown(document, { key: 's' }); // skip: the other pair
    await waitFor(() => expect(cardNames()).toEqual(['Akira, now 9.8', 'Bebop, now 9.5']));
    fireEvent.keyDown(document, { key: 'Backspace' }); // a skip alone can't be undone
    expect(cardNames()).toEqual(['Akira, now 9.8', 'Bebop, now 9.5']);

    const swipe = (dx: number, dy: number) => {
      fireEvent.pointerDown(pair(), { clientX: 200, clientY: 300, pointerId: 1 });
      fireEvent.pointerUp(pair(), { clientX: 200 + dx, clientY: 300 + dy, pointerId: 1 });
    };
    swipe(40, 0);
    swipe(-80, 200);
    expect(screen.getByText('Pick 1')).toBeInTheDocument();
    swipe(-80, 0); // left: Akira
    await screen.findByText('Pick 2');
    fireEvent.keyDown(document, { key: 'Backspace' });
    await screen.findByText('Pick 1');
    swipe(80, 0); // right: Bebop
    await screen.findByText('Pick 2');
    expect(screen.getByRole('heading', { name: 'Fix my ratings' })).toHaveFocus();
  });
});

const LOAD_FAILED = "Couldn't load your ratings. Check your connection and try again.";
const setReply = (rows: Entry[]): MockResponse => ({ body: { items: rows.map(setItem), comparisons: [] } });
const setGets = (calls: { method: string; path: string }[]) => calls.filter((c) => c.method === 'GET' && c.path === '/api/ratings/anime').length;

describe('Fix my ratings: more runs', () => {
  it('a fix run loads the set fresh, not from the chip row\'s cached copy', async () => {
    const rows = lovedAnime();
    const changed = rows.map((e) => (e.id === 'Clannad' ? rated('Clannad', 9.45) : e)); // changed on another device
    const { calls } = setup({ entries: rows, ratingSet: (_s, n) => setReply(n === 1 ? rows : changed) });
    await openTier('Anime (6)', 'Loved 3 titles');
    await screen.findByText('Pick 1');
    expect(cardNames()).toEqual(['Bebop, now 9.5', 'Clannad, now 9.45']);
    expect(setGets(calls)).toBe(2);
  });

  it('All tiers: runs over every tier with their neighbour pairs counted together', async () => {
    setup({ entries: lovedAnime() });
    await userEvent.click(await screen.findByRole('button', { name: 'Anime (6)' }));
    await userEvent.click(await within(await screen.findByRole('group', { name: 'Tiers' })).findByRole('button', { name: 'All tiers' }));
    expect(await screen.findByText('Anime · All tiers')).toBeInTheDocument();
    expect(screen.getByText('0 of 3 neighbours checked')).toBeInTheDocument(); // Loved 2 + Liked 1 + Fine 0
    const first = cardNames();
    expect(first).toHaveLength(2);
    await userEvent.click(within(pair()).getAllByRole('button', { name: /, now / })[0]!);
    await screen.findByText('Pick 2');
    expect(screen.getByText('1 of 3 neighbours checked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    expect(await screen.findByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
  });

  it('a set that fails to load: a toast, and the list and its tiers stay for another try', async () => {
    const rows = lovedAnime();
    setup({ entries: rows, ratingSet: (_s, n) => (n === 1 ? setReply(rows) : { status: 500, body: { error: 'boom' } }) });
    await openTier('Anime (6)', 'Loved 3 titles');
    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'Tiers' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Pick the better one' })).not.toBeInTheDocument();
  });

  it('flipped cards: the left card is the question\'s second title, and it answers "b"', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // below .5: flip
    setup({ entries: lovedAnime() });
    await openTier('Anime (6)', 'Loved 3 titles');
    await screen.findByText('Pick 1');
    expect(cardNames()).toEqual(['Clannad, now 9.4', 'Bebop, now 9.5']); // question order is Bebop, Clannad
    fireEvent.keyDown(document, { key: 'ArrowLeft' }); // the left card: Clannad
    await screen.findByText('Pick 2');
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    await screen.findByRole('heading', { name: 'New ratings' });
    expect(reviewRows()).toEqual([['Clannad', null, '9.4', 'Rating 9.5', 'up'], ['Bebop', null, '9.5', 'Rating 9.4', 'down']]);
  });
});

describe('placing new ratings', () => {
  const queued = () => [rated('Akira', 9.8), rated('Bebop', 9.5), rated('Clannad', 9.4), rated('Gintama', 9.2), rated('Haikyu', 9.1), rated('Dorohedoro', 8)];

  it('queue: places each new rating with ~log2 picks; Save drops it from the queue; Don\'t save keeps it', async () => {
    const { calls } = setup({ entries: queued(), queue: ['Bebop', 'Gintama'] });
    expect(await screen.findByRole('heading', { name: 'Place it' })).toBeInTheDocument();
    expect(screen.getByText('Placing Bebop · pick 1 of about 3')).toBeInTheDocument();
    expect(cardNames()).toEqual(['Bebop, now 9.5', 'Gintama, now 9.2']);
    await userEvent.click(within(pair()).getByRole('button', { name: 'Bebop, now 9.5' }));
    expect(await screen.findByText('Placing Bebop · pick 2 of about 3')).toBeInTheDocument();
    await userEvent.click(within(pair()).getByRole('button', { name: /^Clannad/ }));
    expect(await screen.findByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save new ratings' }));

    // the next queued title
    expect(await screen.findByText(/^Placing Gintama · pick 1 of about 3/)).toBeInTheDocument();
    expect(saves(calls)).toEqual([{
      picks: [
        { winnerId: 'Bebop', loserId: 'Gintama', isTie: false, undone: false },
        { winnerId: 'Clannad', loserId: 'Bebop', isTie: false, undone: false },
      ],
      moves: [],
      done: ['Bebop'],
    }]);
    await userEvent.click(within(pair()).getAllByRole('button', { name: /, now / })[1]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and review' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Don\'t save' }));
    expect(await screen.findByText(/^New ratings are placed\./)).toBeInTheDocument();
    expect(saves(calls)).toHaveLength(1);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('queue: a title with nothing to ask is All good; Close takes it off the queue', async () => {
    const { calls } = setup({ entries: [rated('Akira', 9.8), rated('Dorohedoro', 8)], queue: ['Akira'] });
    expect(await screen.findByRole('heading', { name: 'All good' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/compare/queue/Akira')).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Fix my ratings' })).toBeInTheDocument();
  });

  it('queue: waits when Ask is Only when I start it', async () => {
    setup({ entries: queued(), queue: ['Bebop'], ask: 'Only when I start it' });
    expect(await screen.findByRole('group', { name: 'Lists' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Place it' })).not.toBeInTheDocument();
  });

  it('/compare?place=<id> places that title only, then returns to its list', async () => {
    const { calls, router } = setup({ entries: queued(), queue: ['Gintama'], path: '/compare?place=Bebop' });
    expect(await screen.findByText('Placing Bebop · pick 1 of about 3')).toBeInTheDocument();
    await userEvent.click(within(pair()).getByRole('button', { name: 'Bebop, now 9.5' }));
    await userEvent.click(await within(pair()).findByRole('button', { name: /^Clannad/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save new ratings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(saves(calls)[0]!.done).toEqual(['Bebop']);
  });

  it('/compare?place=<id>: Don\'t save returns to its list too', async () => {
    const { calls, router } = setup({ entries: queued(), path: '/compare?place=Bebop' });
    await screen.findByText('Placing Bebop · pick 1 of about 3');
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(saves(calls)).toEqual([]);
  });
});

describe('placing: gating, no tier and failures', () => {
  const queued = () => [rated('Akira', 9.8), rated('Bebop', 9.5), rated('Clannad', 9.4), rated('Gintama', 9.2), rated('Haikyu', 9.1), rated('Dorohedoro', 8)];

  it('?place= with no tier asks the tier first, then places it', async () => {
    const { calls, router } = setup({ entries: [...queued(), unrated('Zed')], path: '/compare?place=Zed' });
    expect(await screen.findByRole('heading', { name: 'Which tier is Zed in?' })).toBeInTheDocument();
    expect(screen.getByText('Anime · 1 of 1 with no score')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Tier' })).getByRole('button', { name: 'Loved · 9–10' }));
    expect(await screen.findByText(/^Placing Zed · pick 1 of about 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save new ratings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(saves(calls)).toEqual([{ picks: [], moves: [{ id: 'Zed', tier: 3 }], done: ['Zed'] }]);
  });

  it('?place= works when Ask is Only for new ratings', async () => {
    setup({ entries: queued(), ask: 'Only for new ratings', path: '/compare?place=Bebop' });
    expect(await screen.findByText('Placing Bebop · pick 1 of about 3')).toBeInTheDocument();
  });

  it('?place= does nothing when Ask is Only when I start it (Q15): the home shows', async () => {
    const { calls } = setup({ entries: queued(), ask: 'Only when I start it', path: '/compare?place=Bebop' });
    expect(await screen.findByRole('group', { name: 'Lists' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Place it' })).not.toBeInTheDocument();
    expect(setGets(calls)).toBe(0);
  });

  it('?place= whose set fails to load: a toast and back to its list', async () => {
    const { router } = setup({ entries: queued(), path: '/compare?place=Bebop', ratingSet: () => ({ status: 500, body: { error: 'boom' } }) });
    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
  });

  it('offline with a queue: one load attempt, one toast, then home (not one per title)', async () => {
    const { calls } = setup({ entries: queued(), queue: ['Bebop', 'Gintama', 'Haikyu'], ratingSet: () => ({ status: 500, body: { error: 'boom' } }) });
    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'Lists' })).toBeInTheDocument();
    expect(setGets(calls)).toBe(1);
  });
});

describe('rating unrated titles', () => {
  it('unrated: tier question, then placement, then review', async () => {
    const { calls } = setup({ entries: [
      rated('M1', 8, { category: 'movies' }), rated('M2', 7.8, { category: 'movies' }),
      unrated('M3', { category: 'movies' }), unrated('M4', { category: 'movies' }),
    ] });
    await userEvent.click(within(await screen.findByRole('group', { name: 'Unrated lists' })).getByRole('button', { name: 'Movies (2)' }));
    expect(await screen.findByRole('heading', { name: 'Which tier is M3 in?' })).toBeInTheDocument();
    expect(screen.getByText('Movies · 1 of 2 with no score')).toBeInTheDocument();
    const picker = screen.getByRole('group', { name: 'Tier' });
    expect(within(picker).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Loved · 9–10', 'Liked · 7.5–8.9', 'Fine · 6–7.4', 'Didn\'t like · 0–5.9']);
    await userEvent.click(within(picker).getByRole('button', { name: 'Liked · 7.5–8.9' }));

    expect(await screen.findByText('Placing M3 · pick 1 of about 2')).toBeInTheDocument();
    expect(cardNames()[0]).toMatch(/^M3, now /);
    await userEvent.click(within(pair()).getAllByRole('button', { name: /, now / })[0]!);
    await screen.findByText('Placing M3 · pick 2 of about 2');
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('heading', { name: 'Which tier is M4 in?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));

    expect(await screen.findByRole('heading', { name: 'New ratings' })).toBeInTheDocument();
    expect(reviewRows()).toEqual([['M3', 'Liked', '—', 'Rating 8.3', 'up']]);
    await userEvent.click(screen.getByRole('button', { name: 'Save new ratings' }));
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeInTheDocument();
    expect(saves(calls, 'movies')).toEqual([{
      picks: [{ winnerId: 'M3', loserId: 'M2', isTie: false, undone: false }],
      moves: [{ id: 'M3', tier: 2 }],
      done: ['M3', 'M4'],
    }]);
  });
});
