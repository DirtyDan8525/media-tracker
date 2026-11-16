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
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  await userEvent.click(within(nav).getByRole('link', { name: 'Add anime' }));
  await screen.findByRole('textbox', { name: 'Title' });
  return screen.getByRole('dialog', { name: /^Add to / });
}
const posts = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/entries').map((c) => c.body as Record<string, unknown>);
const typeTitle = (d: HTMLElement, t = 'Frieren') => userEvent.type(within(d).getByRole('textbox', { name: 'Title' }), t);
const numberBox = (d: HTMLElement) => within(d).getByRole('spinbutton', { name: 'or type a number' });
const tierButtons = (d: HTMLElement) => within(within(d).getByRole('group', { name: 'Tier' })).getAllByRole('button');

describe('the Add sheet: rate by tier', () => {
  it('uses the board\'s copy and wires the hint to the number box', async () => {
    fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    expect(within(d).getByText('How much did you like it?')).toBeInTheDocument();
    expect(within(d).getByText('or type a number')).toBeInTheDocument();
    expect(numberBox(d)).toHaveAccessibleDescription(/Typing a number picks the tier/);
  });

  it('a tier-only add shows that tier\'s middle score (counts as rated) before the server answers', async () => {
    fakeBackend({ me: meWith(), entries: [makeEntry({ id: 'x1', title: 'Existing', rating: 5 })], extra: { 'POST /api/entries': () => new Promise(() => {}) } });
    renderApp('/list/anime');
    await screen.findByText('Existing'); // the list is loaded, so the new row has somewhere to appear
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.click(within(d).getByRole('button', { name: 'Liked · 7.5–8.9' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    // The row is still "Looking it up…", but it already counts as rated (in the Worker's middle-of-the-tier score).
    await waitFor(() => expect(screen.getByText('2 titles · 2 rated')).toBeInTheDocument());
  });

  it('offers the list\'s four tiers, top first, and an "or type a number" box in place of the slider', async () => {
    fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    expect(tierButtons(d).map((b) => b.getAttribute('aria-label'))).toEqual(['Loved · 9–10', 'Liked · 7.5–8.9', 'Fine · 6–7.4', 'Didn\'t like · 0–5.9']);
    expect(tierButtons(d).every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(numberBox(d)).toHaveValue(null);
    expect(within(d).queryByRole('slider')).not.toBeInTheDocument();
  });

  it('tapping Liked posts { tier: 2 } and no rating', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.click(within(d).getByRole('button', { name: 'Liked · 7.5–8.9' }));
    expect(within(d).getByRole('button', { name: 'Liked · 7.5–8.9' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    const body = posts(calls)[0]!;
    expect(body).toMatchObject({ title: 'Frieren', tier: 2 });
    expect(body).not.toHaveProperty('rating');
  });

  it('typing 9.2 highlights Loved and posts { rating: 9.2 } with no tier', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.type(numberBox(d), '9.2');
    expect(within(d).getByRole('button', { name: 'Loved · 9–10' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(d).getByRole('button', { name: 'Liked · 7.5–8.9' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    const body = posts(calls)[0]!;
    expect(body).toMatchObject({ rating: 9.2 });
    expect(body).not.toHaveProperty('tier');
  });

  it('typing moves the highlight with the number; edge values go to the higher tier (7.5 is Liked, 9 is Loved)', async () => {
    fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    const on = () => tierButtons(d).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'));
    await userEvent.type(numberBox(d), '7.5');
    expect(on()).toEqual(['Liked · 7.5–8.9']);
    await userEvent.clear(numberBox(d));
    await userEvent.type(numberBox(d), '9');
    expect(on()).toEqual(['Loved · 9–10']);
    await userEvent.clear(numberBox(d));
    expect(on()).toEqual([]);
  });

  it('a tapped tier and a typed number replace each other, and the last one is what is posted', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.type(numberBox(d), '9.2');
    await userEvent.click(within(d).getByRole('button', { name: 'Fine · 6–7.4' }));
    expect(numberBox(d)).toHaveValue(null);
    await userEvent.type(numberBox(d), '5');
    expect(within(d).getByRole('button', { name: 'Fine · 6–7.4' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(d).getByRole('button', { name: 'Didn\'t like · 0–5.9' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ rating: 5 });
    expect(posts(calls)[0]).not.toHaveProperty('tier');
  });

  it('tapping the chosen tier again leaves the title unrated', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    const liked = within(d).getByRole('button', { name: 'Liked · 7.5–8.9' });
    await userEvent.click(liked);
    await userEvent.click(liked);
    expect(liked).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).not.toHaveProperty('tier');
    expect(posts(calls)[0]).not.toHaveProperty('rating');
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

  it('the list\'s own tier names and ranges show (custom Anime tiers)', async () => {
    const { calls } = fakeBackend({ me: meWith('Both', { anime: { names: ['Skip', 'Okay', 'Great', 'Peak'], bounds: [5, 7, 9.5] } }) });
    renderApp('/list/anime');
    const d = await openAdd();
    expect(tierButtons(d).map((b) => b.getAttribute('aria-label'))).toEqual(['Peak · 9.5–10', 'Great · 7–9.4', 'Okay · 5–6.9', 'Skip · 0–4.9']);
    await typeTitle(d);
    await userEvent.type(numberBox(d), '9.3');
    expect(within(d).getByRole('button', { name: 'Great · 7–9.4' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(d).getByRole('button', { name: 'Peak · 9.5–10' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ tier: 3 });
  });
});

describe('the Add sheet: Add and place it', () => {
  const placeButton = (d: HTMLElement) => within(d).queryByRole('button', { name: 'Add and place it' });

  it.each([
    ['Both', true],
    ['Only for new ratings', true],
    ['Only when I start it', false],
    ['Off', false],
  ])('with Ask to compare = %s and a tier chosen: shown = %s', async (ask, shown) => {
    fakeBackend({ me: meWith(ask) });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.click(within(d).getByRole('button', { name: 'Liked · 7.5–8.9' }));
    expect(Boolean(placeButton(d))).toBe(shown);
    expect(within(d).getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('shows only when something is rated: a tier or a typed number', async () => {
    fakeBackend({ me: meWith() });
    renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    expect(placeButton(d)).not.toBeInTheDocument();
    await userEvent.type(numberBox(d), '8');
    expect(placeButton(d)).toBeInTheDocument();
    await userEvent.clear(numberBox(d));
    expect(placeButton(d)).not.toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Fine · 6–7.4' }));
    expect(placeButton(d)).toBeInTheDocument();
  });

  it('creates the entry, then opens /compare?place=<id>', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    const { router } = renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.type(numberBox(d), '9.2');
    await userEvent.click(placeButton(d)!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/compare'));
    expect(posts(calls)[0]).toMatchObject({ title: 'Frieren', rating: 9.2 });
    const id = new URLSearchParams(router.state.location.search).get('place');
    expect(id).toBeTruthy();
    expect(id).not.toMatch(/^tmp-/); // the saved entry's id, not the placeholder
  });

  it('plain Add stays on the list', async () => {
    const { calls } = fakeBackend({ me: meWith() });
    const { router } = renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.click(within(d).getByRole('button', { name: 'Liked · 7.5–8.9' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Looking it up…')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/list/anime');
  });

  it('waits for the "which one did you mean?" choice before opening Compare', async () => {
    const three = ['Frieren', 'Frieren Movie', 'Frieren: Beyond'].map((t) => makeInfo({ title: t, sourceId: t }));
    fakeBackend({ me: meWith(), lookup: () => ({ body: { info: { ...three[0]!, choices: three } } }) });
    const { router } = renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d, 'frieren');
    await userEvent.click(within(d).getByRole('button', { name: 'Liked · 7.5–8.9' }));
    await userEvent.click(placeButton(d)!);
    await screen.findByRole('textbox', { name: 'Search again' });
    expect(router.state.location.pathname).toBe('/list/anime');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Which one did you mean?' })).getByRole('button', { name: 'Frieren Movie' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/compare'));
  });

  it('a failed save stays on the list', async () => {
    fakeBackend({ me: meWith(), extra: { 'POST /api/entries': { status: 500, body: { error: 'boom' } } } });
    const { router } = renderApp('/list/anime');
    const d = await openAdd();
    await typeTitle(d);
    await userEvent.click(within(d).getByRole('button', { name: 'Liked · 7.5–8.9' }));
    await userEvent.click(placeButton(d)!);
    expect(await screen.findByText("Couldn't save that. Check your connection and try again.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/list/anime');
  });
});
