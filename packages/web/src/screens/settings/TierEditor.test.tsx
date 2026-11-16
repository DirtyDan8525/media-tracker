import type { TierSet } from '@media-tracker/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi, type Call } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const PEAK: TierSet = { names: ['Skip', 'Okay', 'Great', 'Peak'], bounds: [5, 7, 9.5] };
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT' && c.path.startsWith('/api/ratings/tiers/'));

function setup(tiers?: Partial<Record<'anime' | 'movies', TierSet>>, tabs: Record<string, boolean> = {}) {
  const me = makeMe({}, tabs);
  me.settings = { ...me.settings, ...(tiers ? { tiers } : {}) };
  const calls = mockApi(me, {
    'PUT /api/ratings/tiers/:list': (b, _u, p) => {
      const t = (b as { tiers: TierSet | null }).tiers;
      const next = { ...me.settings, tiers: { ...me.settings.tiers, [p.list!]: t ?? undefined } };
      return { body: { settings: next, entries: [] } };
    },
  });
  return calls;
}
const nameBox = (saved: string) => screen.getByRole('textbox', { name: `${saved} name` });
const fromBox = (saved: string) => screen.getByRole('textbox', { name: `${saved} from` });
const save = () => screen.getByRole('button', { name: 'Save' });
async function replace(box: HTMLElement, text: string) {
  await userEvent.clear(box);
  if (text) await userEvent.type(box, text);
}

describe('Settings: Rating tiers', () => {
  it('shows the list\'s current tiers top first, with from numbers and the Loved / Didn\'t like ends', async () => {
    setup();
    renderApp('/settings/tiers');
    await screen.findByRole('heading', { level: 1, name: 'Rating tiers' });
    const lists = screen.getByRole('group', { name: 'Lists' });
    expect(within(lists).getAllByRole('button').map((b) => b.textContent)).toContain('Anime');
    expect(within(lists).getByRole('button', { name: 'Anime' })).toHaveAttribute('aria-pressed', 'true');
    expect([nameBox('Loved'), nameBox('Liked'), nameBox('Fine'), nameBox("Didn't like")].map((b) => (b as HTMLInputElement).value))
      .toEqual(['Loved', 'Liked', 'Fine', "Didn't like"]);
    expect([fromBox('Loved'), fromBox('Liked'), fromBox('Fine'), fromBox("Didn't like")].map((b) => (b as HTMLInputElement).value))
      .toEqual(['9.0', '7.5', '6.0', '0']);
    expect(fromBox("Didn't like")).toBeDisabled();
    expect(screen.getByText('to 10')).toBeInTheDocument();
    expect(save()).toBeDisabled(); // nothing to save until something changes
  });

  it('editing Loved to 8.5 and Save PUTs that list only, then the toast names the list', async () => {
    const calls = setup();
    renderApp('/settings/tiers');
    await screen.findByRole('heading', { name: 'Rating tiers' });
    await replace(fromBox('Loved'), '8.5');
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    await waitFor(() => expect(puts(calls).map((c) => [c.path, c.body])).toEqual([
      ['/api/ratings/tiers/anime', { tiers: { names: ["Didn't like", 'Fine', 'Liked', 'Loved'], bounds: [6, 7.5, 8.5] } }],
    ]));
    expect(await screen.findByText('Tiers saved. Scores on Anime spread over the new ranges.')).toBeInTheDocument();
  });

  it('names are trimmed and saved; a list chip switches to that list\'s own tiers', async () => {
    const calls = setup({ anime: PEAK });
    renderApp('/settings/tiers');
    await screen.findByRole('heading', { name: 'Rating tiers' });
    expect((nameBox('Peak') as HTMLInputElement).value).toBe('Peak');
    expect((fromBox('Peak') as HTMLInputElement).value).toBe('9.5');
    await userEvent.click(screen.getByRole('button', { name: 'Movies' }));
    expect((fromBox('Loved') as HTMLInputElement).value).toBe('9.0');
    await replace(nameBox('Fine'), '  Okay-ish ');
    await userEvent.click(save());
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.path).toBe('/api/ratings/tiers/movies');
    expect(puts(calls)[0]!.body).toEqual({ tiers: { names: ["Didn't like", 'Okay-ish', 'Liked', 'Loved'], bounds: [6, 7.5, 9] } });
  });

  it('invalid sets block Save with each field\'s own error', async () => {
    const calls = setup();
    renderApp('/settings/tiers');
    await screen.findByRole('heading', { name: 'Rating tiers' });
    // a tier thinner than 0.5: Loved from 9.8 leaves Loved 0.2 wide
    await replace(fromBox('Loved'), '9.8');
    expect(fromBox('Loved')).toHaveAccessibleDescription('Each tier needs at least 0.5');
    expect(fromBox('Loved')).toBeInvalid();
    expect(save()).toBeDisabled();
    // two decimals
    await replace(fromBox('Loved'), '8.55');
    expect(fromBox('Loved')).toHaveAccessibleDescription('One decimal');
    expect(save()).toBeDisabled();
    await replace(fromBox('Loved'), '9');
    expect(fromBox('Loved')).not.toBeInvalid();
    // the same name twice (ignoring case), on both fields
    await replace(nameBox('Liked'), 'LOVED');
    expect(nameBox('Liked')).toHaveAccessibleDescription('Names must be different');
    expect(nameBox('Loved')).toHaveAccessibleDescription('Names must be different');
    expect(save()).toBeDisabled();
    await userEvent.click(save());
    expect(puts(calls)).toEqual([]);
    // out of order bounds
    await replace(nameBox('Liked'), 'Liked');
    await replace(fromBox('Liked'), '9.5');
    expect(save()).toBeDisabled();
    expect(screen.getAllByText('Each tier needs at least 0.5').length).toBeGreaterThan(0);
  });

  it('an empty name asks for 1 to 20 characters', async () => {
    setup();
    renderApp('/settings/tiers');
    await screen.findByRole('heading', { name: 'Rating tiers' });
    await replace(nameBox('Fine'), '');
    expect(nameBox('Fine')).toHaveAccessibleDescription('Use 1 to 20 characters');
    expect(save()).toBeDisabled();
  });

  it('Reset to defaults PUTs null and shows the default tiers again', async () => {
    const calls = setup({ anime: PEAK });
    renderApp('/settings/tiers');
    await screen.findByRole('heading', { name: 'Rating tiers' });
    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() => expect(puts(calls).map((c) => [c.path, c.body])).toEqual([['/api/ratings/tiers/anime', { tiers: null }]]));
    await waitFor(() => expect((nameBox('Loved') as HTMLInputElement).value).toBe('Loved'));
    expect((fromBox('Loved') as HTMLInputElement).value).toBe('9.0');
    expect(await screen.findByText('Tiers saved. Scores on Anime spread over the new ranges.')).toBeInTheDocument();
  });

  it('a failed save keeps the edits and says so', async () => {
    const me = makeMe();
    mockApi(me, { 'PUT /api/ratings/tiers/:list': { status: 500, body: { error: 'boom' } } });
    renderApp('/settings/tiers');
    await screen.findByRole('heading', { name: 'Rating tiers' });
    await replace(fromBox('Loved'), '8.5');
    await userEvent.click(save());
    expect(await screen.findByText("Couldn't save the tiers. Try again.")).toBeInTheDocument();
    expect((fromBox('Loved') as HTMLInputElement).value).toBe('8.5');
    expect(save()).toBeEnabled();
  });

  it('only enabled lists get a chip', async () => {
    setup(undefined, { movies: false, tv: false, albums: false, songs: false, games: false, books: false });
    renderApp('/settings/tiers');
    await screen.findByRole('heading', { name: 'Rating tiers' });
    const lists = screen.getByRole('group', { name: 'Lists' });
    expect(within(lists).getAllByRole('button').map((b) => b.textContent)).toEqual(['Anime']);
  });
});

describe('Settings: Comparing links', () => {
  it('Rating tiers and Re-tier review sit under Ask to compare', async () => {
    mockApi(makeMe());
    renderApp('/settings/appearance');
    const section = await screen.findByRole('region', { name: 'Comparing' });
    expect(within(section).getByRole('link', { name: 'Rating tiers' })).toHaveAttribute('href', '/settings/tiers');
    expect(within(section).getByRole('link', { name: 'Re-tier review' })).toHaveAttribute('href', '/retier/anime');
  });
});
