import type { ActivityItem, ActivityPage } from '@media-tracker/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';

const NOW = new Date(2026, 10, 15, 12, 0, 0);
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const yesterday = new Date(2026, 10, 14, 21, 40).toISOString();

let n = 0;
function item(over: Partial<ActivityItem> & Pick<ActivityItem, 'type' | 'title'>): ActivityItem {
  n++;
  return { id: `a${n}`, entryId: `e-${over.title}`, category: 'anime', coverUrl: '', payload: {}, createdAt: ago(1), ...over };
}
const page = (items: ActivityItem[], next: ActivityPage['next'] = null): ActivityPage => ({ items, next });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const activityCalls = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith('/api/activity'));

describe('ActivityScreen', () => {
  it('renders "You re-rated Steins;Gate 7.0 → 8.5" with the title as a link to the entry', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: page([item({ type: 're-rated', title: 'Steins;Gate', payload: { from: 7, to: 8.5 } })]) } } });
    renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Steins;Gate' })).closest('li')!;
    expect(row).toHaveTextContent('You re-rated Steins;Gate 7.0 → 8.5');
    expect(screen.getByRole('link', { name: 'Steins;Gate' })).toHaveAttribute('href', '/entry/e-Steins;Gate');
  });

  it('shows a merged rating and status as "You rated Frieren 9.5 · marked Completed"', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: page([
      item({ type: 'status', title: 'Frieren', payload: { from: 'Watching / In Progress', to: 'Completed' }, createdAt: ago(1) }),
      item({ type: 'rated', title: 'Frieren', payload: { from: null, to: 9.5 }, createdAt: ago(3) }),
    ]) } } });
    renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Frieren' })).closest('li')!;
    expect(row).toHaveTextContent('You rated Frieren 9.5 · marked Completed');
    expect(screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('Frieren'))).toHaveLength(1);
  });

  it('status wording uses statusLabel ("marked Playing" for games)', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: page([
      item({ type: 'status', title: 'Celeste', category: 'games', payload: { from: 'Plan to watch', to: 'Watching / In Progress' } }),
    ]) } } });
    renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Celeste' })).closest('li')!;
    expect(row).toHaveTextContent('You marked Celeste Playing');
  });

  it('added shows "You added Mob Psycho 100 to Anime"', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: page([item({ type: 'added', title: 'Mob Psycho 100', payload: {} })]) } } });
    renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Mob Psycho 100' })).closest('li')!;
    expect(row).toHaveTextContent('You added Mob Psycho 100 to Anime');
  });

  it('a line has the avatar initial, a <time> with the relative time and an aria-hidden cover', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: page([item({ type: 'added', title: 'Bleach', createdAt: ago(5), coverUrl: 'https://img.example/b.jpg' })]) } } });
    const { container } = renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Bleach' })).closest('li')!;
    const time = row.querySelector('time')!;
    expect(time).toHaveTextContent('5 min ago');
    expect(time).toHaveAttribute('datetime', ago(5));
    expect(within(row).getByText('D')).toBeInTheDocument(); // username "dan"
    expect(row.querySelector('img')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('.activity-line__avatar')).toHaveAttribute('aria-hidden', 'true');
  });

  it('lines sit under "Today" and "Yesterday" headings', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: page([
      item({ type: 'added', title: 'Bleach', createdAt: ago(5) }),
      item({ type: 'added', title: 'Naruto', createdAt: yesterday }),
    ]) } } });
    renderApp('/activity');
    await screen.findByRole('link', { name: 'Bleach' });
    const today = screen.getByRole('heading', { name: 'Today' });
    const yest = screen.getByRole('heading', { name: 'Yesterday' });
    expect(today.compareDocumentPosition(screen.getByRole('link', { name: 'Bleach' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(today.compareDocumentPosition(yest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(yest.compareDocumentPosition(screen.getByRole('link', { name: 'Naruto' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the filter radiogroup "Show" has Everyone, Friends, You with You checked', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: page([]) } } });
    renderApp('/activity');
    const group = await screen.findByRole('radiogroup', { name: 'Show' });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['everyone', 'friends', 'you']);
    expect(within(group).getByRole('radio', { name: 'You' })).toBeChecked();
  });

  it('choosing Friends sets ?show=friends, shows "Nothing here yet" and Add friend toasts, with no request', async () => {
    const { calls } = fakeBackend({ extra: { 'GET /api/activity': { body: page([item({ type: 'added', title: 'Bleach' })]) } } });
    const { router } = renderApp('/activity?show=friends');
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('Add friends to see what they rate and finish. Your own activity shows here too.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Friends' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect(await screen.findByText('Coming with friends')).toBeInTheDocument();
    expect(activityCalls(calls)).toHaveLength(0);

    await userEvent.click(screen.getByRole('radio', { name: 'You' }));
    expect(await screen.findByRole('link', { name: 'Bleach' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
    const after = activityCalls(calls).length;
    await userEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
    expect(router.state.location.search).toBe('?show=everyone');
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    expect(activityCalls(calls)).toHaveLength(after);
  });

  it('Show more fetches with before & beforeId and appends', async () => {
    const { calls } = fakeBackend({ extra: { 'GET /api/activity': (_b, url) => ({
      body: url.searchParams.get('before')
        ? page([item({ type: 'added', title: 'Older', createdAt: ago(300) })])
        : page([item({ type: 'added', title: 'Newer', createdAt: ago(2) })], { before: ago(2), beforeId: 'a-last' }),
    }) } });
    renderApp('/activity');
    await screen.findByRole('link', { name: 'Newer' });
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('link', { name: 'Older' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Newer' })).toBeInTheDocument();
    const second = activityCalls(calls)[1]!.path;
    expect(second).toContain(`before=${encodeURIComponent(ago(2))}`);
    expect(second).toContain('beforeId=a-last');
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('merges across the pages together: one line for edits split over two pages, none for a change and back', async () => {
    fakeBackend({ extra: { 'GET /api/activity': (_b, url) => ({
      body: url.searchParams.get('before')
        ? page([
            item({ type: 're-rated', title: 'Frieren', payload: { from: 7, to: 8 }, createdAt: ago(21) }),
            item({ type: 're-rated', title: 'Bleach', payload: { from: 6, to: 7 }, createdAt: ago(30) }),
          ])
        : page([
            item({ type: 're-rated', title: 'Frieren', payload: { from: 8, to: 9 }, createdAt: ago(20) }),
            item({ type: 're-rated', title: 'Bleach', payload: { from: 7, to: 6 }, createdAt: ago(25) }),
          ], { before: ago(20), beforeId: 'x' }),
    }) } });
    renderApp('/activity');
    await screen.findByRole('link', { name: 'Frieren' });
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Frieren' }).closest('li')).toHaveTextContent('You re-rated Frieren 7.0 → 9.0'));
    expect(screen.getAllByRole('link', { name: 'Frieren' })).toHaveLength(1);
    // Bleach 6 -> 7 (page 2) then 7 -> 6 (page 1): ends where it began, so nothing to show.
    expect(screen.queryByRole('link', { name: 'Bleach' })).not.toBeInTheDocument();
  });

  it('You with no rows shows "Nothing here yet" and a link to the current list', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: page([]) } } });
    renderApp('/activity');
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('Add or rate something and it shows up here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Anime' })).toHaveAttribute('href', '/list/anime');
  });

  it('each day is a region named by its heading, through a valid id (older days have spaces and commas in their label)', async () => {
    const older = new Date(2026, 10, 12, 9, 0).toISOString();
    fakeBackend({ extra: { 'GET /api/activity': { body: page([
      item({ type: 'added', title: 'Bleach', createdAt: ago(5) }),
      item({ type: 'added', title: 'Naruto', createdAt: older }),
    ]) } } });
    const { container } = renderApp('/activity');
    await screen.findByRole('link', { name: 'Naruto' });
    const olderLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(older));
    expect(screen.getByRole('region', { name: 'Today' })).toContainElement(screen.getByRole('link', { name: 'Bleach' }));
    expect(screen.getByRole('region', { name: olderLabel })).toContainElement(screen.getByRole('link', { name: 'Naruto' }));
    for (const s of container.querySelectorAll('section[aria-labelledby]')) {
      const id = s.getAttribute('aria-labelledby')!;
      expect(id, 'an IDREF has no whitespace or commas').toMatch(/^[A-Za-z][\w-]*$/);
      expect(document.getElementById(id)?.tagName).toBe('H2');
    }
  });

  it('the relative time ticks while the screen is open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    fakeBackend({ extra: { 'GET /api/activity': { body: page([item({ type: 'added', title: 'Bleach', createdAt: NOW.toISOString() })]) } } });
    renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Bleach' })).closest('li')!;
    expect(row.querySelector('time')).toHaveTextContent('just now');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(row.querySelector('time')).toHaveTextContent('1 min ago');
    act(() => { vi.advanceTimersByTime(4 * 60_000); });
    expect(row.querySelector('time')).toHaveTextContent('5 min ago');
  });

  it('a failed Show more says "Couldn\'t load more." and keeps the loaded lines and the button', async () => {
    fakeBackend({ extra: { 'GET /api/activity': (_b, url) => {
      if (url.searchParams.get('before')) throw new TypeError('Failed to fetch');
      return { body: page([item({ type: 'added', title: 'Newer', createdAt: ago(2) })], { before: ago(2), beforeId: 'a-last' }) };
    } } });
    renderApp('/activity');
    await screen.findByRole('link', { name: 'Newer' });
    expect(screen.queryByText("Couldn't load more.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText("Couldn't load more.")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load more.").closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Newer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeEnabled();
  });

  it('Show more is disabled and busy while the next page loads', async () => {
    let release: (() => void) | undefined;
    fakeBackend({ extra: { 'GET /api/activity': (_b, url) => {
      if (!url.searchParams.get('before')) {
        return { body: page([item({ type: 'added', title: 'Newer', createdAt: ago(2) })], { before: ago(2), beforeId: 'a-last' }) };
      }
      return new Promise((resolve) => {
        release = () => resolve({ body: page([item({ type: 'added', title: 'Older', createdAt: ago(300) })]) });
      });
    } } });
    renderApp('/activity');
    await screen.findByRole('link', { name: 'Newer' });
    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more).not.toHaveAttribute('aria-busy', 'true');
    await userEvent.click(more);
    await waitFor(() => expect(more).toBeDisabled());
    expect(more).toHaveAttribute('aria-busy', 'true');
    release!();
    expect(await screen.findByRole('link', { name: 'Older' })).toBeInTheDocument();
  });

  it('offline shows "Couldn\'t load your activity" with Retry', async () => {
    let up = false;
    fakeBackend({ extra: { 'GET /api/activity': () => {
      if (!up) throw new TypeError('Failed to fetch');
      return { body: page([item({ type: 'added', title: 'Bleach' })]) };
    } } });
    renderApp('/activity');
    expect(await screen.findByText("Couldn't load your activity")).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Bleach' })).toBeInTheDocument();
  });
});
