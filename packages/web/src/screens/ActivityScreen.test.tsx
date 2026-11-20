import type { ActivityItem, ActivityPage } from '@media-tracker/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

const NOW = new Date(2026, 10, 15, 12, 0, 0);
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const yesterday = new Date(2026, 10, 14, 21, 40).toISOString();

let n = 0;
function item(over: Partial<ActivityItem> & Pick<ActivityItem, 'type' | 'title'>): ActivityItem {
  n++;
  // Each row is its own post unless the test names one.
  return { id: `a${n}`, postId: `a${n}`, userId: 'u1', entryId: `e-${over.title}`, category: 'anime', coverUrl: '', payload: {}, createdAt: ago(1), ...over };
}
const page = (items: ActivityItem[], next: ActivityPage['next'] = null): ActivityPage => ({ items, users: {}, friends: [], social: {}, next });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const activityCalls = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith('/api/activity?'));

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
      item({ type: 'status', title: 'Frieren', payload: { from: 'Watching / In Progress', to: 'Completed' }, createdAt: ago(1), postId: 'p-frieren' }),
      item({ type: 'rated', title: 'Frieren', payload: { from: null, to: 9.5 }, createdAt: ago(3), id: 'p-frieren', postId: 'p-frieren' }),
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

  it('the filter radiogroup "Show" has Everyone, Friends, You with Everyone checked, and asks for show=everyone', async () => {
    const { calls } = fakeBackend({ extra: { 'GET /api/activity': { body: page([]) } } });
    renderApp('/activity');
    const group = await screen.findByRole('radiogroup', { name: 'Show' });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['everyone', 'friends', 'you']);
    expect(within(group).getByRole('radio', { name: 'Everyone' })).toBeChecked();
    await waitFor(() => expect(activityCalls(calls)[0]!.path).toBe('/api/activity?show=everyone'));
  });

  it('choosing Friends and You ask for their own scope and keep the choice in ?show=', async () => {
    const { calls } = fakeBackend({ extra: { 'GET /api/activity': { body: page([]) } } });
    const { router } = renderApp('/activity?show=friends');
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('Add a friend to see what they rate.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Friends' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'You' }));
    expect(router.state.location.search).toBe('?show=you');
    expect(await screen.findByText('Add or rate something and it shows up here.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
    expect(router.state.location.search).toBe('');
    expect(activityCalls(calls).map((c) => c.path)).toEqual(expect.arrayContaining(['/api/activity?show=friends', '/api/activity?show=you', '/api/activity?show=everyone']));
  });

  it('Show more fetches with before & beforeId and appends', async () => {
    const { calls } = fakeBackend({ extra: { 'GET /api/activity': (_b, url) => ({
      body: url.searchParams.get('before')
        ? page([item({ type: 'added', title: 'Older', createdAt: ago(300) })])
        : page([item({ type: 'added', title: 'Newer', createdAt: ago(2) })], { before: ago(2), beforeId: 'a-last' }),
    }) } });
    renderApp('/activity?show=you');
    await screen.findByRole('link', { name: 'Newer' });
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('link', { name: 'Older' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Newer' })).toBeInTheDocument();
    expect(activityCalls(calls)[0]!.path).toBe('/api/activity?show=you');
    const second = activityCalls(calls)[1]!.path;
    expect(second).toContain('show=you');
    expect(second).toContain(`before=${encodeURIComponent(ago(2))}`);
    expect(second).toContain('beforeId=a-last');
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('folds posts across the pages together: one line for a post split over two pages, none for a change and back', async () => {
    fakeBackend({ extra: { 'GET /api/activity': (_b, url) => ({
      body: url.searchParams.get('before')
        ? page([
            item({ type: 're-rated', title: 'Frieren', payload: { from: 7, to: 8 }, createdAt: ago(21), postId: 'p-f' }),
            item({ type: 're-rated', title: 'Bleach', payload: { from: 6, to: 7 }, createdAt: ago(30), postId: 'p-b' }),
          ])
        : page([
            item({ type: 're-rated', title: 'Frieren', payload: { from: 8, to: 9 }, createdAt: ago(20), postId: 'p-f' }),
            item({ type: 're-rated', title: 'Bleach', payload: { from: 7, to: 6 }, createdAt: ago(25), postId: 'p-b' }),
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
    renderApp('/activity?show=you');
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

describe('ActivityScreen: friends, reactions, comments', () => {
  const ren = { id: 'u-ren', username: 'ren', displayName: 'Ren', avatarAt: '2026-11-01T00:00:00.000Z' };
  const frieren = (over: Partial<ActivityItem> = {}) =>
    item({ type: 'rated', title: 'Frieren', userId: 'u-ren', entryId: 'e-fr', id: 'p-fr', postId: 'p-fr', payload: { from: null, to: 9 }, ...over });
  const renPage = (social: ActivityPage['social'] = {}): ActivityPage => ({ items: [frieren()], users: { 'u-ren': ren }, friends: ['u-ren'], social, next: null });

  it('Everyone shows "Ren rated Frieren 9.0" with Ren\'s avatar, the name linking to /u/ren and the title to /u/ren/entry/<id>', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: renPage() } } });
    const { container } = renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Frieren' })).closest('li')!;
    expect(row).toHaveTextContent('Ren rated Frieren 9.0');
    expect(screen.getByRole('link', { name: 'Ren' })).toHaveAttribute('href', '/u/ren');
    expect(screen.getByRole('link', { name: 'Frieren' })).toHaveAttribute('href', '/u/ren/entry/e-fr');
    expect(container.querySelector('.activity-line__avatar img')).toHaveAttribute('src', expect.stringContaining('/api/users/u-ren/avatar?v='));
  });

  it('your own lines still read "You" and link to /entry/<id> next to a friend\'s', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: { ...renPage(), items: [frieren(), item({ type: 'added', title: 'Bleach' })] } } } });
    renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Bleach' })).closest('li')!;
    expect(row).toHaveTextContent('You added Bleach to Anime');
    expect(screen.getByRole('link', { name: 'Bleach' })).toHaveAttribute('href', '/entry/e-Bleach');
  });

  it('tapping 🔥 toggles aria-pressed and the count at once, and rolls back with a toast on error', async () => {
    let fail = true;
    let release: (() => void) | undefined;
    fakeBackend({ extra: {
      'GET /api/activity': { body: renPage({ 'p-fr': { reactions: { '🔥': 1 }, mine: [], comments: 2 } }) },
      'POST /api/reactions': () => new Promise((resolve) => {
        release = () => resolve(fail ? { status: 500, body: { error: 'boom' } } : { body: { reactions: { '🔥': 2 }, mine: ['🔥'], comments: 2 } });
      }),
    } });
    renderApp('/activity');
    const fire = await screen.findByRole('button', { name: '🔥 1' });
    expect(fire).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(fire);
    const pressed = await screen.findByRole('button', { name: '🔥 2' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    release!();
    expect(await screen.findByText("Couldn't save your reaction. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🔥 1' })).toHaveAttribute('aria-pressed', 'false');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: '🔥 1' }));
    expect(await screen.findByRole('button', { name: '🔥 2' })).toHaveAttribute('aria-pressed', 'true');
    release!();
    await waitFor(() => expect(screen.getByRole('button', { name: '🔥 2' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('opening Everyone and Friends calls POST /api/activity/seen, You does not', async () => {
    const { calls } = fakeBackend({ extra: { 'GET /api/activity': { body: page([]) }, 'POST /api/activity/seen': { status: 204 } } });
    renderApp('/activity?show=you');
    await screen.findByText('Nothing here yet');
    expect(calls.filter((c) => c.path === '/api/activity/seen')).toHaveLength(0);
    await userEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/activity/seen')).toHaveLength(1));
    await userEvent.click(screen.getByRole('radio', { name: 'Friends' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/activity/seen')).toHaveLength(2));
  });

  it('"Comment (2)" opens the thread sheet for that post', async () => {
    const { calls } = fakeBackend({ extra: {
      'GET /api/activity': { body: renPage({ 'p-fr': { reactions: {}, mine: [], comments: 2 } }) },
      'GET /api/comments': { body: [] },
    } });
    renderApp('/activity');
    await userEvent.click(await screen.findByRole('button', { name: 'Comment (2)' }));
    expect(await screen.findByRole('dialog', { name: 'Comments' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/comments?activityId=p-fr')).toBe(true);
  });

  it('a post carries a rating badge, only the reaction chips that exist, and React + Comment buttons', async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: renPage({ 'p-fr': { reactions: { '❤️': 3, '🇯🇵': 1 }, mine: [], comments: 0 } }) } } });
    renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Frieren' })).closest('li')!;
    expect(within(row).getByLabelText('Rating 9.0')).toBeInTheDocument();
    expect(within(row).getAllByRole('button', { pressed: false }).map((b) => b.getAttribute('aria-label')).filter(Boolean)).toEqual(['❤️ 3', '🇯🇵 1']);
    expect(within(row).getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Comment' })).toBeInTheDocument();
  });

  it('a post with no reactions shows no chips; your own post has your avatar', async () => {
    const { container } = (fakeBackend({ extra: { 'GET /api/activity': { body: page([item({ type: 'added', title: 'Bleach' })]) } } }), renderApp('/activity'));
    const row = (await screen.findByRole('link', { name: 'Bleach' })).closest('li')!;
    expect(within(row).queryByRole('group', { name: 'Reactions' })).not.toBeInTheDocument();
    expect(container.querySelector('.feed-post .avatar')).toHaveTextContent('D');
  });

  it('React > 😮 and React > + > typed emoji both POST the emoji for that post', async () => {
    const { calls } = fakeBackend({ extra: {
      'GET /api/activity': { body: renPage() },
      'POST /api/reactions': { body: { reactions: { '😮': 1 }, mine: ['😮'], comments: 0 } },
    } });
    renderApp('/activity');
    await userEvent.click(await screen.findByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: '😮' }));
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: 'More emojis' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Type any emoji' }), '🎉');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/reactions').map((c) => c.body))
      .toEqual([{ activityId: 'p-fr', emoji: '😮' }, { activityId: 'p-fr', emoji: '🎉' }]));
  });
});

describe('ActivityScreen: everyone and deleting posts', () => {
  const sam = { id: 'u-sam', username: 'sam', displayName: 'Sam', avatarAt: null };
  const own = (title: string, over: Partial<ActivityItem> = {}) => item({ type: 'added', title, payload: { rating: 8 }, ...over });
  const strangerPage = (): ActivityPage => ({
    items: [item({ type: 'rated', title: 'Mushishi', userId: 'u-sam', entryId: 'e-mu', payload: { from: null, to: 8 } })],
    users: { 'u-sam': sam }, friends: [], social: {}, next: null,
  });

  it("a non-friend's name links to /u/<username>, their title is plain text; reacting and commenting stay available", async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: strangerPage() } } });
    renderApp('/activity');
    const row = (await screen.findByText('Mushishi')).closest('li')!;
    expect(row).toHaveTextContent('Sam rated Mushishi 8.0');
    expect(within(row).getByRole('link', { name: 'Sam' })).toHaveAttribute('href', '/u/sam');
    expect(within(row).queryByRole('link', { name: 'Mushishi' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Comment' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Options for/ })).not.toBeInTheDocument();
  });

  it('only your own posts have a ⋯ menu; "Delete post" asks first, then DELETEs the anchor and drops the post', async () => {
    const { calls } = fakeBackend({ extra: {
      'GET /api/activity': { body: { ...strangerPage(), items: [...strangerPage().items, own('Bleach', { id: 'p-bl', postId: 'p-bl' }), own('Naruto', { id: 'p-na', postId: 'p-na' })] } },
      'DELETE /api/activity/:id': { status: 204 },
    } });
    renderApp('/activity');
    const row = (await screen.findByRole('link', { name: 'Bleach' })).closest('li')!;
    expect(screen.getAllByRole('button', { name: /^Options for/ })).toHaveLength(2);
    await userEvent.click(within(row).getByRole('button', { name: 'Options for Bleach' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete this post?' });
    expect(sheet).toHaveTextContent('The title stays on your list.');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete post' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Bleach' })).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/activity/p-bl']);
    expect(screen.getByRole('link', { name: 'Naruto' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Post deleted')).toBeInTheDocument();
  });

  it('Cancel leaves the post and sends nothing; a failed delete keeps the sheet and says so', async () => {
    let fail = true;
    const { calls } = fakeBackend({ extra: {
      'GET /api/activity': { body: page([own('Bleach', { id: 'p-bl', postId: 'p-bl' })]) },
      'DELETE /api/activity/:id': () => (fail ? { status: 500, body: { error: 'boom' } } : { status: 204 }),
    } });
    renderApp('/activity');
    await userEvent.click(await screen.findByRole('button', { name: 'Options for Bleach' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Options for Bleach' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete post' }));
    expect(await screen.findByText("Couldn't delete that. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bleach' })).toBeInTheDocument();
  });

  it('Select appears on You only; checkboxes sit on your posts, "Delete N posts" confirms and POSTs one batch', async () => {
    const { calls } = fakeBackend({ extra: {
      'GET /api/activity': { body: page([own('Bleach', { id: 'p-bl', postId: 'p-bl' }), own('Naruto', { id: 'p-na', postId: 'p-na' }), own('Frieren', { id: 'p-fr', postId: 'p-fr' })]) },
      'POST /api/activity/delete': { body: { deleted: 2 } },
    } });
    renderApp('/activity');
    await screen.findByRole('link', { name: 'Bleach' });
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'You' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    expect(screen.getByRole('button', { name: 'Delete 0 posts' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Options for/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Bleach' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Frieren' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2 posts' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete 2 posts?' });
    expect(sheet).toHaveTextContent('The titles stay on your list.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete 2 posts' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Bleach' })).not.toBeInTheDocument());
    const posted = calls.filter((c) => c.method === 'POST' && c.path === '/api/activity/delete');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toEqual({ postIds: ['p-bl', 'p-fr'] });
    expect(screen.getByRole('link', { name: 'Naruto' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); // select mode ended
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
  });

  it('Done leaves Select mode without deleting; switching scope ends it too', async () => {
    const { calls } = fakeBackend({ extra: { 'GET /api/activity': { body: page([own('Bleach')]) } } });
    renderApp('/activity?show=you');
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Bleach' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' || c.path === '/api/activity/delete')).toBe(false);
  });

  describe('creator, notes, search and text size', () => {
    it('a song shows its artist after the title; other lists show the creator in muted text', async () => {
      fakeBackend({ extra: { 'GET /api/activity': { body: page([
        item({ type: 'rated', title: 'Blinding Lights', category: 'songs', creator: 'The Weeknd', payload: { from: null, to: 9 } }),
        item({ type: 'rated', title: 'Frieren', creator: 'Madhouse', payload: { from: null, to: 9 } }),
      ]) } } });
      const { container } = renderApp('/activity');
      const song = (await screen.findByRole('link', { name: 'Blinding Lights' })).closest('li')!;
      expect(song.querySelector('.activity-line__sentence')).toHaveTextContent('You rated Blinding Lights · The Weeknd 9.0');
      const anime = screen.getByRole('link', { name: 'Frieren' }).closest('li')!;
      expect(anime.querySelector('.activity-line__creator')).toHaveTextContent('Madhouse');
      expect(container.querySelectorAll('.activity-line__creator')).toHaveLength(1);
    });

    it('shows the note as a quote; a long one is clamped with More / Less, nothing without a note', async () => {
      const long = 'A very long review. '.repeat(20);
      fakeBackend({ extra: { 'GET /api/activity': { body: page([
        item({ type: 'rated', title: 'Frieren', note: long, payload: { from: null, to: 9 } }),
        item({ type: 'rated', title: 'Bleach', note: 'Short one.', payload: { from: null, to: 7 } }),
        item({ type: 'rated', title: 'Naruto', note: null, payload: { from: null, to: 6 } }),
      ]) } } });
      renderApp('/activity');
      const frieren = (await screen.findByRole('link', { name: 'Frieren' })).closest('li')!;
      const text = frieren.querySelector('.feed-post__note-text')!;
      expect(text).toHaveClass('feed-post__note-text--clamped');
      await userEvent.click(within(frieren).getByRole('button', { name: 'More' }));
      expect(text).not.toHaveClass('feed-post__note-text--clamped');
      await userEvent.click(within(frieren).getByRole('button', { name: 'Less' }));
      expect(text).toHaveClass('feed-post__note-text--clamped');
      const bleach = screen.getByRole('link', { name: 'Bleach' }).closest('li')!;
      expect(bleach).toHaveTextContent('Short one.');
      expect(within(bleach).queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Naruto' }).closest('li')!.querySelector('.feed-post__note')).toBeNull();
    });

    const feedFor = () => page([
      item({ type: 'rated', title: 'Amélie', category: 'movies', creator: 'Jean-Pierre Jeunet', payload: { from: null, to: 9 } }),
      item({ type: 'rated', title: 'Frieren', creator: 'Madhouse', note: 'Gorgeous soundtrack', payload: { from: null, to: 9 } }),
      item({ type: 'rated', title: 'Bleach', userId: 'u2', payload: { from: null, to: 7 } }),
    ]);
    const withRen = () => ({ ...feedFor(), users: { u2: { id: 'u2', username: 'ren', displayName: 'Renée', avatarAt: null } } });

    it('search filters loaded posts by title, creator, note and person, ignoring case and accents', async () => {
      fakeBackend({ extra: { 'GET /api/activity': { body: withRen() } } });
      renderApp('/activity');
      await screen.findByRole('link', { name: 'Frieren' });
      const box = screen.getByRole('searchbox', { name: 'Search posts' });
      const shown = () => screen.queryAllByRole('listitem').filter((li) => li.classList.contains('feed-post')).map((li) => li.querySelector('strong:not(:first-child), .activity-line__title')?.textContent);
      await userEvent.type(box, 'amelie');
      expect(screen.getByRole('link', { name: 'Amélie' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Frieren' })).not.toBeInTheDocument();
      await userEvent.clear(box);
      await userEvent.type(box, 'MADHOUSE');
      expect(screen.getByRole('link', { name: 'Frieren' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Amélie' })).not.toBeInTheDocument();
      await userEvent.clear(box);
      await userEvent.type(box, 'soundtrack');
      expect(screen.getByRole('link', { name: 'Frieren' })).toBeInTheDocument();
      await userEvent.clear(box);
      await userEvent.type(box, 'renee');
      expect(screen.getByText('Bleach')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Frieren' })).not.toBeInTheDocument();
      await userEvent.clear(box);
      await userEvent.type(box, 'zzz');
      expect(screen.getByText('No matching posts')).toBeInTheDocument();
      void shown;
    });

    it('with more pages, says "Searching loaded posts" and Show more keeps working', async () => {
      const { calls } = fakeBackend({ extra: { 'GET /api/activity': { body: page([item({ type: 'rated', title: 'Frieren', payload: { from: null, to: 9 } })], { before: 'x', beforeId: 'y' }) } } });
      renderApp('/activity');
      await userEvent.type(await screen.findByRole('searchbox', { name: 'Search posts' }), 'frie');
      expect(screen.getByText('Searching loaded posts')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
      await waitFor(() => expect(activityCalls(calls).length).toBeGreaterThan(1));
    });

    it('the Aa control scales the feed, saves under activity-text-size and leaves the chat key alone', async () => {
      fakeBackend({ extra: { 'GET /api/activity': { body: feedFor() } } });
      renderApp('/activity');
      await screen.findByRole('link', { name: 'Frieren' });
      const screenEl = () => document.querySelector<HTMLElement>('.activity-screen')!;
      expect(screenEl().style.getPropertyValue('--activity-scale')).toBe('1');
      await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
      await userEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
      expect(screenEl().style.getPropertyValue('--activity-scale')).toBe('1.15');
      expect(localStorage.getItem('activity-text-size')).toBe('115');
      expect(localStorage.getItem('chat-text-size')).toBeNull();
    });
  });

  describe('details (PC panel, phone sheet)', () => {
    const feed = () => page([
      item({ type: 'rated', title: 'Frieren', creator: 'Madhouse', note: 'Gorgeous soundtrack, full text here', payload: { from: null, to: 9 }, status: undefined } as never),
      item({ type: 'rated', title: 'Bleach', payload: { from: null, to: 7 } }),
    ]);

    it('PC: starts with a hint; hover (after the settle delay) and keyboard focus fill the panel', async () => {
      setViewportWidth(1280);
      fakeBackend({ extra: { 'GET /api/activity': { body: feed() } } });
      renderApp('/activity');
      await screen.findByRole('link', { name: 'Frieren' });
      const panel = screen.getByRole('complementary', { name: 'Post details' });
      expect(panel).toHaveTextContent('Hover a post to see the details');
      vi.useRealTimers();
      const li = screen.getByRole('link', { name: 'Frieren' }).closest('li')!;
      await userEvent.hover(li);
      await waitFor(() => expect(within(panel).getByRole('heading', { name: 'Frieren' })).toBeInTheDocument());
      expect(panel).toHaveTextContent('Madhouse');
      expect(panel).toHaveTextContent('Gorgeous soundtrack, full text here');
      expect(within(panel).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/entry/e-Frieren');
      // Keyboard focus on another post switches at once.
      await userEvent.click(within(screen.getByRole('link', { name: 'Bleach' }).closest('li')!).getByRole('button', { name: /React/ }));
      expect(within(panel).getByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
    });

    it('phone: tapping a post opens the same details in a sheet; no panel', async () => {
      fakeBackend({ extra: { 'GET /api/activity': { body: feed() } } });
      renderApp('/activity');
      const li = (await screen.findByRole('link', { name: 'Frieren' })).closest('li')!;
      expect(screen.queryByRole('complementary', { name: 'Post details' })).not.toBeInTheDocument();
      await userEvent.click(li.querySelector('.activity-line__text')!);
      const sheet = await screen.findByRole('dialog', { name: 'Post details' });
      expect(within(sheet).getByRole('heading', { name: 'Frieren' })).toBeInTheDocument();
      expect(sheet).toHaveTextContent('Gorgeous soundtrack, full text here');
    });

    it('phone: a song post plays its preview right from the sheet, using the exact Deezer id (Dan, 2026-11-20)', async () => {
      const { calls } = fakeBackend({ extra: {
        'GET /api/activity': { body: page([item({ type: 'rated', category: 'songs', title: 'Mr. Blue Sky', creator: 'Electric Light Orchestra', source: 'deezer', sourceId: 'track:123', payload: { from: null, to: 9 } } as never)]) },
        'GET /api/preview': { body: { url: 'https://cdnt-preview.dzcdn.net/x.mp3' } },
        'GET /api/spotify/link': { body: { url: null } },
      } });
      renderApp('/activity');
      const li = (await screen.findByRole('link', { name: /Mr\. Blue Sky/ })).closest('li')!;
      await userEvent.click(li.querySelector('.activity-line__text')!);
      const sheet = await screen.findByRole('dialog', { name: 'Post details' });
      expect(await within(sheet).findByRole('button', { name: /Play preview/ })).toBeInTheDocument();
      expect(within(sheet).getByRole('link', { name: /Open in Spotify/ })).toBeInTheDocument();
      const preview = calls.find((c) => c.path.startsWith('/api/preview'))!;
      expect(preview.path).toContain('id=track%3A123');
    });
  });
});
