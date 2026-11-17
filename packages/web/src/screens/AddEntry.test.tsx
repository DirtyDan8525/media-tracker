import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Category, TierSet } from '@media-tracker/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry, makeInfo } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';


function meWith(ask = 'Both', tiers?: Partial<Record<Category, TierSet>>) {
  const me = makeMe();
  me.settings = { ...me.settings, compareAsk: ask, ...(tiers ? { tiers } : {}) };
  return me;
}

async function openAdd() {
  // The phone's Add is the Main nav's (bottom bar's) Add link (B3).
  await screen.findByRole('navigation', { name: 'Main' });
  await userEvent.click(await screen.findByRole('link', { name: 'Add anime' }));
  await screen.findByRole('textbox', { name: 'Title' });
  return screen.getByRole('dialog', { name: 'Add' });
}
const posts = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/entries').map((c) => c.body as Record<string, unknown>);
const typeTitle = (d: HTMLElement, t = 'Frieren') => userEvent.type(within(d).getByRole('textbox', { name: 'Title' }), t);
const numberBox = (d: HTMLElement) => within(d).getByRole('spinbutton', { name: 'Rating' });
const saves = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/ratings/anime/save').map((c) => c.body as Record<string, unknown>);

/** A close title for the new entry: GET /api/ratings/anime/close/:id answers it, and the save nudges both. */
function closeRoutes() {
  const arcane = { id: 'arc', title: 'Arcane', rating: 9.6, typed: 9.6, tier: 3, priorMean: 9.6, strength: 9.6, scoreLocked: false, cover: '', square: false, status: 'Completed' };
  return {
    'GET /api/ratings/anime/close/:id': (_b: unknown, _u: URL, p: Record<string, string>) => ({
      body: { item: { ...arcane, id: p.id, title: 'Frieren', status: null }, others: [arcane] },
    }),
    'POST /api/ratings/anime/save': (b: unknown) => {
      const w = (b as { picks: { winnerId: string }[] }).picks[0]!.winnerId;
      return { body: { items: [{ ...arcane, id: w, title: w === 'arc' ? 'Arcane' : 'Frieren', rating: 9.62 }, { ...arcane, id: w === 'arc' ? 'new' : 'arc', title: w === 'arc' ? 'Frieren' : 'Arcane', rating: 9.58 }], entries: [] } };
    },
  };
}

describe('the Add sheet: number-first rating (AddRate board)', () => {
  it('has one Rating number box with the board\'s hint, and no tier buttons or "Add and place it"', async () => {
    fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    expect(numberBox(d)).toHaveValue(null);
    expect(numberBox(d)).toHaveAccessibleDescription('0 to 10, one decimal. Leave empty to skip.');
    expect(within(d).queryByRole('group', { name: 'Tier' })).not.toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: 'Add and place it' })).not.toBeInTheDocument();
    expect(within(d).queryByRole('slider')).not.toBeInTheDocument();
  });

  it('typing 9.2 posts { rating: 9.2 } and no tier', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.type(numberBox(d), '9.2');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ title: 'Frieren', rating: 9.2 });
    expect(posts(calls)[0]).not.toHaveProperty('tier');
  });

  it('a number outside 0–10 shows the rating error and blocks Add', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.type(numberBox(d), '12');
    expect(within(d).getByRole('alert')).toHaveTextContent('Use a number from 0 to 10');
    expect(within(d).getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(posts(calls)).toEqual([]);
  });

  it('a planned title has no rating field and posts no rating (N8)', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.type(numberBox(d), '8');
    await userEvent.click(within(d).getByRole('button', { name: 'Plan to watch' }));
    expect(within(d).queryByRole('spinbutton', { name: 'Rating' })).not.toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ status: 'Plan to watch' });
    expect(posts(calls)[0]).not.toHaveProperty('rating');
  });
});

describe('the Add sheet: the close-call sheet after a rated add (RateClose board)', () => {
  it('asks "Which did you like more?" (1 of 1), saves the pick at once, then shows the nudged numbers', async () => {
    const { calls } = fakeBackend({ me: meWith(), extra: closeRoutes() });
    const { router } = renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.type(numberBox(d), '9.6');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Close call' });
    expect(within(sheet).getByText('Which did you like more?')).toBeInTheDocument();
    expect(within(sheet).getByText('1 of 1')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'About the same' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Arcane, 9.6' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]).toMatchObject({ picks: [{ winnerId: 'arc', isTie: false, undone: false }], moves: [], done: [] });
    expect(await within(sheet).findByText('Nudged to break the tie.')).toBeInTheDocument();
    expect(within(sheet).getByText('9.62')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Close call' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/list/anime');
  });

  it('Skip saves nothing and closes when nothing moved', async () => {
    const { calls } = fakeBackend({ me: meWith(), extra: closeRoutes() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.type(numberBox(d), '9.6');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Close call' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Close call' })).not.toBeInTheDocument());
    expect(saves(calls)).toEqual([]);
  });

  it('asks nothing when the setting is off, or for an unrated add', async () => {
    for (const [ask, rating] of [['Off', '9.6'], ['Both', '']] as const) {
      const { calls } = fakeBackend({ me: meWith(ask), extra: closeRoutes() });
      const { unmount } = renderApp('/list/anime');
      const d = await openAdd();
      await typeTitle(d);
      if (rating) await userEvent.type(numberBox(d), rating);
      await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
      await waitFor(() => expect(posts(calls)).toHaveLength(1));
      await waitFor(() => expect(screen.queryByText('Looking it up…')).not.toBeInTheDocument());
      expect(calls.some((c) => c.path.includes('/close/'))).toBe(false);
      expect(screen.queryByRole('dialog', { name: 'Close call' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('waits for the "which one did you mean?" choice before asking', async () => {
    const three = ['Frieren', 'Frieren Movie', 'Frieren: Beyond'].map((t) => makeInfo({ title: t, sourceId: t }));
    const { calls } = fakeBackend({ me: meWith(), lookup: () => ({ body: { info: { ...three[0]!, choices: three } } }), extra: closeRoutes() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d, 'frieren');
    await userEvent.type(numberBox(d), '9.6');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await screen.findByRole('textbox', { name: 'Search again' });
    expect(calls.some((c) => c.path.includes('/close/'))).toBe(false);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Which one did you mean?' })).getByRole('button', { name: 'Frieren Movie' }));
    expect(await screen.findByRole('dialog', { name: 'Close call' })).toBeInTheDocument();
  });
});

describe('the Add sheet: "Add to" list dropdown', () => {
  const addTo = (d: HTMLElement) => within(d).getByRole('button', { name: /^Add to/ });

  it('defaults to the current list, is a menu button, and lists every enabled list', async () => {
    fakeBackend({ me: meWith() });
    renderApp('/list/movies');
    await screen.findByRole('navigation', { name: 'Main' });
    await userEvent.click(await screen.findByRole('link', { name: 'Add movie' }));
    const d = await screen.findByRole('dialog', { name: 'Add' });
    const button = addTo(d);
    expect(button).toHaveTextContent('Movies');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    const items = within(screen.getByRole('menu', { name: 'Add to' })).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Anime', 'Movies', 'TV Shows', 'Albums', 'Songs', 'Games', 'Books', 'Manga']);
    expect(items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.textContent)).toEqual(['Movies']);
  });

  it('Escape closes only the menu (the sheet stays) and focus returns to the "Add to" button', async () => {
    fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await userEvent.click(addTo(d));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add' })).toBeInTheDocument();
    expect(addTo(d)).toHaveFocus();
  });

  it('choosing another list switches the field label and status words, and the title is added to that list', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await userEvent.click(within(d).getByRole('button', { name: 'Plan to watch' }));
    await userEvent.click(addTo(d));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Games' }));
    expect(addTo(d)).toHaveTextContent('Games');
    expect(addTo(d)).toHaveFocus();
    expect(within(d).getByRole('button', { name: 'Plan to play' })).toHaveAttribute('aria-pressed', 'false'); // status reset, Games wording
    await typeTitle(d, 'Hades');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ category: 'games', title: 'Hades' });
    expect(await screen.findByText('Added to Games')).toBeInTheDocument();
  });

  it('a list with no status hides the status chips; adding to the default list sends no extra toast', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await userEvent.click(addTo(d));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Movies' }));
    expect(within(d).queryByRole('button', { name: 'Completed' })).not.toBeInTheDocument();
    await userEvent.click(addTo(d));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Anime' }));
    await typeTitle(d, 'Frieren');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)[0]).toMatchObject({ category: 'anime' }));
    expect(screen.queryByText(/^Added to/)).not.toBeInTheDocument();
  });
});
