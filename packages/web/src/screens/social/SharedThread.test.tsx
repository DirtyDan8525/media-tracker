import type { ActivityItem, ActivityPage, Comment, PostSocial } from '@media-tracker/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend } from '../../test/fakeBackend';
import { makeFriendEntry } from '../../test/friends';
import { renderApp } from '../../test/renderApp';

// Dan, 2026-11-20 (migration 0025): reactions and comments are the title's. Andre rated a song; Dan reacts and comments on
// Andre's Activity post, then opens Andre's title page: the same reactions and the same comment count are there.
// The fake server keeps one thread per title, like the Worker (a post id resolves to its title).
const andre = { id: 'u-andre', username: 'andre', displayName: 'Andre', avatarAt: null };
const DAN = { id: 'id-dan', username: 'dan', displayName: null, avatarAt: null };

function server(gets: { reactions: number }) {
  const thread: { reactions: Record<string, string[]>; comments: Comment[] } = { reactions: { '❤️': ['u-ren'] }, comments: [] };
  const postEntry: Record<string, string> = { 'p-song': 'e-song', 'p-song2': 'e-song' };
  const entryOf = (q: URLSearchParams | Record<string, unknown>) => {
    const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : (q[k] as string | undefined)) ?? null;
    const a = get('activityId');
    return a ? postEntry[a] : get('entryId');
  };
  const social = (): PostSocial => ({
    reactions: Object.fromEntries(Object.entries(thread.reactions).filter(([, us]) => us.length > 0).map(([e, us]) => [e, us.length])),
    mine: Object.entries(thread.reactions).filter(([, us]) => us.includes(DAN.id)).map(([e]) => e),
    comments: thread.comments.length,
  });
  const item = (postId: string, to: number): ActivityItem => ({
    id: postId, postId, userId: andre.id, type: 'rated', entryId: 'e-song', category: 'songs', title: 'Blue Song', coverUrl: '', creator: 'Band',
    payload: { from: null, to }, createdAt: new Date().toISOString(),
  } as ActivityItem);
  const feed = (): ActivityPage => ({
    items: [item('p-song', 8), item('p-song2', 9)], users: { [andre.id]: andre }, friends: [andre.id],
    social: { 'p-song': social(), 'p-song2': social() }, next: null,
  });
  return {
    'GET /api/activity': () => ({ body: feed() }),
    'GET /api/reactions': (_b: unknown, url: URL) => {
      gets.reactions++;
      return entryOf(url.searchParams) === 'e-song' ? { body: social() } : { status: 404, body: { error: 'not_found' } };
    },
    'POST /api/reactions': (b: unknown) => {
      const { emoji } = b as { emoji: string };
      if (entryOf(b as Record<string, unknown>) !== 'e-song') return { status: 404, body: { error: 'not_found' } };
      const us = thread.reactions[emoji] ?? [];
      thread.reactions[emoji] = us.includes(DAN.id) ? us.filter((u) => u !== DAN.id) : [...us, DAN.id];
      return { body: social() };
    },
    'GET /api/comments': (_b: unknown, url: URL) => (entryOf(url.searchParams) === 'e-song' ? { body: thread.comments } : { status: 404, body: {} }),
    'POST /api/comments': (b: unknown) => {
      const c: Comment = { id: `c${thread.comments.length + 1}`, author: DAN, body: (b as { body: string }).body, image: false, expired: false, createdAt: new Date().toISOString(), canDelete: true };
      thread.comments.push(c);
      return { status: 201, body: c };
    },
    'GET /api/users/:username/entries/:id': () => ({
      body: { entry: makeFriendEntry({ id: 'e-song', userId: andre.id, title: 'Blue Song', category: 'songs', creator: 'Band', rating: 9 }), seasons: [] },
    }),
  };
}

describe("one thread per title: a post and the friend's title page match", () => {
  it("a 🔥 and a comment on Andre's post show on every post about the song and on his title page", async () => {
    const gets = { reactions: 0 };
    const { calls } = fakeBackend({ extra: server(gets) as never });
    const { router } = renderApp('/activity?show=friends');
    const posts = await screen.findAllByRole('listitem').then((lis) => lis.filter((li) => li.textContent?.includes('Blue Song')));
    expect(posts).toHaveLength(2);

    // React 🔥 on the first post: both posts about the song show it at once.
    await userEvent.click(within(posts[0]!).getByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: '🔥' }));
    await waitFor(() => {
      for (const p of posts) expect(within(p).getByRole('button', { name: '🔥 1' })).toHaveAttribute('aria-pressed', 'true');
    });
    // The post is how Dan reached it, so the API is asked by post id (a non-friend in Everyone has no title page).
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/reactions')!.body).toEqual({ activityId: expect.stringMatching(/^p-song2?$/), emoji: '🔥' });

    // Comment from the second post: both posts count it.
    await userEvent.click(within(posts[1]!).getByRole('button', { name: 'Comment' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Add a comment' }), 'What a chorus');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('What a chorus')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      for (const p of posts) expect(within(p).getByRole('button', { name: 'Comment (1)' })).toBeInTheDocument();
    });

    // Andre's title page: the same reactions (Ren's ❤️ and Dan's 🔥) and the same comment count, and the same thread.
    await userEvent.click(within(posts[0]!).getByRole('link', { name: 'Blue Song' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/u/andre/entry/e-song'));
    const section = await screen.findByRole('region', { name: 'Reactions and comments' });
    expect(within(section).getByRole('button', { name: '🔥 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(section).getByRole('button', { name: '❤️ 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByRole('button', { name: 'Comment (1)' })).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Comment (1)' }));
    expect(await screen.findByText('What a chorus')).toBeInTheDocument();
  });

  it("reacting on the title page updates the cached posts about it, and the page's own cache is the one the posts update", async () => {
    const gets = { reactions: 0 };
    fakeBackend({ extra: server(gets) as never });
    const { router } = renderApp('/u/andre/entry/e-song');
    const section = await screen.findByRole('region', { name: 'Reactions and comments' });
    await waitFor(() => expect(within(section).getByRole('button', { name: '❤️ 1' })).toBeInTheDocument());
    await userEvent.click(within(section).getByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: '😂' }));
    await waitFor(() => expect(within(section).getByRole('button', { name: '😂 1' })).toHaveAttribute('aria-pressed', 'true'));
    await router.navigate('/activity?show=friends');
    const posts = await screen.findAllByRole('listitem').then((lis) => lis.filter((li) => li.textContent?.includes('Blue Song')));
    for (const p of posts) expect(within(p).getByRole('button', { name: '😂 1' })).toHaveAttribute('aria-pressed', 'true');
    // Toggled off from a post: the title page (cached, not read again) shows it gone too.
    await userEvent.click(within(posts[1]!).getByRole('button', { name: '😂 1' }));
    await waitFor(() => expect(within(posts[0]!).queryByRole('button', { name: /😂/ })).not.toBeInTheDocument());
    const before = gets.reactions;
    await router.navigate('/u/andre/entry/e-song');
    const again = await screen.findByRole('region', { name: 'Reactions and comments' });
    expect(within(again).queryByRole('button', { name: /😂/ })).not.toBeInTheDocument();
    expect(within(again).getByRole('button', { name: '❤️ 1' })).toBeInTheDocument();
    expect(gets.reactions).toBe(before); // from the shared cache
  });
});
