import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { THEMES } from '@media-tracker/shared';
import { applyTheme, contrast } from '../design/theme';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { waitingCount } from './CompareBanner';
import { setCompareEnabled } from '../test/flags';

beforeEach(() => setCompareEnabled(true)); // these exercise Compare, which is hidden in the real build

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

describe('banner details', () => {
  it('shows up to 3 covers of the queued entries, decoratively', async () => {
    const es = [1, 2, 3, 4].map((i) => makeEntry({ id: `c${i}`, title: `T${i}`, coverUrl: `https://img.example/${i}.jpg` }));
    es.push(makeEntry({ id: 'nocover', title: 'NC', coverUrl: '' }));
    fakeBackend({ entries: es, extra: { 'GET /api/compare/queue': { body: { items: ['nocover', 'c1', 'c2', 'c3', 'c4'].map((entryId) => ({ entryId, category: 'anime' })) } } } });
    renderApp('/list/anime');
    const text = await screen.findByText('5 new ratings to double-check');
    await waitFor(() => expect(text.parentElement!.querySelector('.compare-banner__stack')).not.toBeNull());
    const stack = text.parentElement!.querySelector('.compare-banner__stack')!;
    expect(stack).toHaveAttribute('aria-hidden', 'true');
    expect([...stack.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      'https://img.example/1.jpg', 'https://img.example/2.jpg', 'https://img.example/3.jpg',
    ]);
  });
  it('has no stack when no queued entry is cached with a cover', async () => {
    mockApi(makeMe(), { 'GET /api/compare/queue': { body: queue(2) } });
    renderApp('/list/anime');
    const text = await screen.findByText('2 new ratings to double-check');
    expect(text.parentElement!.querySelector('.compare-banner__stack')).toBeNull();
  });
  it('keeps its live region mounted, empty at 0, and fills it when ratings arrive', async () => {
    let items = queue(0).items;
    mockApi(makeMe(), { 'GET /api/compare/queue': () => ({ body: { items } }) });
    const { queryClient } = renderApp('/list/anime');
    await screen.findByText('No anime yet');
    const region = document.querySelector('[data-testid="compare-banner-status"]')!;
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();
    items = queue(1).items;
    await queryClient.invalidateQueries({ queryKey: ['compare-queue'] });
    expect(await screen.findByText('1 new rating to double-check')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="compare-banner-status"]')).toBe(region);
  });
});

describe('waiting pill', () => {
  it('renders the count in a filled Highlight pill in More', async () => {
    mockApi(makeMe(), { 'GET /api/compare/queue': { body: queue(3) } });
    renderApp('/more');
    const link = await screen.findByRole('link', { name: 'Compare, 3 waiting' });
    const pill = link.querySelector('.count-pill')!;
    expect(pill).toHaveTextContent('3');
  });
  it('pill label is the primary-button colour, or black/white where that fails: at least 4.5:1 on Highlight in every theme', () => {
    for (const name of Object.keys(THEMES)) {
      applyTheme({ theme: name, colors: {} } as never);
      const root = document.documentElement.style;
      expect(contrast(root.getPropertyValue('--on-highlight-small'), root.getPropertyValue('--highlight')), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});


describe('with Compare hidden', () => {
  it('shows no banner and never requests the queue', async () => {
    setCompareEnabled(false);
    const calls = mockApi(makeMe(), { 'GET /api/compare/queue': { body: queue(3) } });
    renderApp('/list/anime');
    await screen.findByText('No anime yet');
    expect(screen.queryByText(/to double-check/)).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.includes('/api/compare/queue'))).toBe(false);
  });
});
