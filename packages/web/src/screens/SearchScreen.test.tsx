import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const sample = () => [
  makeEntry({ title: 'Frieren', rating: 9, creator: 'Madhouse' }),
  makeEntry({ title: 'Bleach', rating: 8 }),
  makeEntry({ category: 'movies', title: 'Friday', rating: 7 }),
];

beforeEach(() => localStorage.clear());

describe('SearchScreen', () => {
  it('an empty field shows the hint text', async () => {
    fakeBackend({ entries: sample() });
    renderApp('/search');
    expect(await screen.findByText('Search titles, creators, albums and genres.')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search your lists' })).toHaveFocus();
  });

  it('typing "fri" shows Frieren under "Anime" and not Bleach, and the URL gets ?q=fri', async () => {
    fakeBackend({ entries: sample() });
    const { router } = renderApp('/search');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search your lists' }), 'fri');
    const link = await screen.findByRole('link', { name: /Frieren/ });
    expect(link).toHaveAttribute('href', expect.stringMatching(/^\/entry\//));
    expect(screen.getByRole('heading', { name: 'Anime · 1' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Movies · 1' })).toBeInTheDocument();
    expect(screen.queryByText('Bleach')).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe('?q=fri'));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('starts from ?q= in the URL', async () => {
    fakeBackend({ entries: sample() });
    renderApp('/search?q=bleach');
    expect(await screen.findByRole('link', { name: /Bleach/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search your lists' })).toHaveValue('bleach');
  });

  it('the toggle "All lists | Anime" saves searchScope current and narrows to the current list', async () => {
    const { calls } = fakeBackend({ entries: sample() });
    renderApp('/search?q=fri');
    await screen.findByRole('link', { name: /Friday/ });
    const group = screen.getByRole('radiogroup', { name: 'Search in' });
    expect(within(group).getByRole('radio', { name: 'All lists' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: 'Anime' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Friday/ })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Frieren/ })).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/api/me/settings')?.body).toEqual({ settings: { searchScope: 'current' } }));
  });

  it('the toggle names the current list the last list screen showed', async () => {
    fakeBackend({ entries: sample() });
    const { router } = renderApp('/list/movies');
    await screen.findByText('Friday');
    await router.navigate('/search');
    expect(await screen.findByRole('radio', { name: 'Movies' })).toBeInTheDocument();
  });

  it('no match in current scope offers "Search all lists"', async () => {
    const { calls } = fakeBackend({ entries: sample(), me: makeMe({ settings: { ...makeMe().settings, searchScope: 'current' } }) });
    renderApp('/search?q=friday');
    expect(await screen.findByText('No matches for “friday”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Search all lists' }));
    expect(await screen.findByRole('link', { name: /Friday/ })).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ settings: { searchScope: 'all' } }));
  });

  it('no match with all lists says so without the extra button', async () => {
    fakeBackend({ entries: sample() });
    renderApp('/search?q=zzz');
    expect(await screen.findByText('No matches for “zzz”.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search all lists' })).not.toBeInTheDocument();
  });

  it('51 matches in one list shows 50 and "Show 1 more"', async () => {
    const many = Array.from({ length: 51 }, (_, i) => makeEntry({ title: `Naruto ${String(i).padStart(2, '0')}`, rating: 5 }));
    fakeBackend({ entries: many });
    renderApp('/search?q=naruto');
    expect(await screen.findByRole('heading', { name: 'Anime · 51' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Naruto/ })).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));
    expect(screen.getAllByRole('link', { name: /Naruto/ })).toHaveLength(51);
    expect(screen.queryByRole('button', { name: /Show .* more/ })).not.toBeInTheDocument();
  });

  it('respects turned-off lists', async () => {
    fakeBackend({ entries: sample(), me: makeMe({}, { movies: false }) });
    renderApp('/search?q=fri');
    await screen.findByRole('link', { name: /Frieren/ });
    expect(screen.queryByRole('link', { name: /Friday/ })).not.toBeInTheDocument();
  });
});
