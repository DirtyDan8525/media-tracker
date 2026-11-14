import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { waitingCount } from './CompareBanner';

const queue = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ entryId: `e${i}`, category: 'anime' })) });

describe('waitingCount', () => {
  const items = [
    { entryId: 'a', category: 'anime' as const },
    { entryId: 'b', category: 'movies' as const },
  ];
  const s = (compareAsk: string, tabs: Record<string, boolean> = {}) => ({ ...makeMe().settings, compareAsk, tabs: { ...makeMe().settings.tabs, ...tabs } });
  it('counts queue items in enabled lists when Ask is Both or Only for new ratings', () => {
    expect(waitingCount(items, s('Both'))).toBe(2);
    expect(waitingCount(items, s('Only for new ratings'))).toBe(2);
    expect(waitingCount(items, s('Both', { movies: false }))).toBe(1);
  });
  it('is 0 when Ask is Off or Only when I start it', () => {
    expect(waitingCount(items, s('Off'))).toBe(0);
    expect(waitingCount(items, s('Only when I start it'))).toBe(0);
  });
});

describe('queue banner on a list', () => {
  it('says 1 new rating, singular, with a Compare link', async () => {
    mockApi(makeMe(), { 'GET /api/compare/queue': { body: queue(1) } });
    renderApp('/list/anime');
    const status = (await screen.findByText('1 new rating to double-check')).closest('[role="status"]') as HTMLElement;
    expect(status).toHaveTextContent('1 new rating to double-check');
    expect(status.querySelector('a')).toHaveAttribute('href', '/compare');
  });
  it('says 3 new ratings, plural', async () => {
    mockApi(makeMe(), { 'GET /api/compare/queue': { body: queue(3) } });
    renderApp('/list/movies');
    expect(await screen.findByText('3 new ratings to double-check')).toBeInTheDocument();
  });
  it('is hidden with an empty queue', async () => {
    mockApi(makeMe(), { 'GET /api/compare/queue': { body: queue(0) } });
    renderApp('/list/anime');
    await screen.findByText('No anime yet');
    expect(screen.queryByText(/to double-check/)).not.toBeInTheDocument();
  });
  it.each(['Off', 'Only when I start it'])('is hidden when Ask is %s', async (ask) => {
    const me = makeMe();
    me.settings.compareAsk = ask;
    mockApi(me, { 'GET /api/compare/queue': { body: queue(2) } });
    renderApp('/list/anime');
    await screen.findByText('No anime yet');
    expect(screen.queryByText(/to double-check/)).not.toBeInTheDocument();
  });
  it('does not count items in a turned-off list', async () => {
    mockApi(makeMe({}, { tv: false }), { 'GET /api/compare/queue': { body: { items: [{ entryId: 'x', category: 'tv' }] } } });
    renderApp('/list/anime');
    await screen.findByText('No anime yet');
    expect(screen.queryByText(/to double-check/)).not.toBeInTheDocument();
  });
});
