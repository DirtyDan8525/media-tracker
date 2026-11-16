import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { relationOf } from '../src/social/visibility';
import { spyD1 } from './d1spy';

// A8: friends must be active. A pending or removed user's data stays, but nobody else sees it.
const A = 'a@example.com'; // dan, the viewer
const B = 'b@example.com'; // ren, A's friend, whose status changes

const as = (email: string, path: string, method = 'GET', body?: unknown, db?: D1Database) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
const json = async <T = any>(res: Response) => (await res.json()) as T;
const uid = async (email: string) => (await json<{ id: string }>(await as(email, '/api/me'))).id;
const setStatus = (id: string, status: string) => env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id).run();

let a: string;
let b: string;
let bEntry: string;
let aEntry: string;

beforeEach(async () => {
  expect((await as(A, '/api/me/username', 'PUT', { username: 'dan' })).status).toBe(200);
  expect((await as(B, '/api/me/username', 'PUT', { username: 'ren' })).status).toBe(200);
  a = await uid(A);
  b = await uid(B);
  await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
  expect((await as(B, `/api/friends/${a}/accept`, 'POST')).status).toBe(204);
  // a tiny avatar for B
  await env.DB.prepare("INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?, 'image/png', x'00', 'x')").bind(b).run();
  bEntry = (await json<{ entry: { id: string } }>(await as(B, '/api/entries', 'POST', { category: 'anime', title: 'Frieren', rating: 9 }))).entry.id;
  aEntry = (await json<{ entry: { id: string } }>(await as(A, '/api/entries', 'POST', { category: 'anime', title: 'Mine', rating: 8 }))).entry.id;
  expect((await as(B, '/api/comments', 'POST', { entryId: aEntry, body: 'nice' })).status).toBe(201);
  expect((await as(B, '/api/reactions', 'POST', { entryId: aEntry, emoji: '🔥' })).status).toBe(200);
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

/** Everything A can see of B. */
async function seen() {
  const friends = await json<{ friends: { id: string }[] }>(await as(A, '/api/friends'));
  const entries = await json<{ userId: string }[]>(await as(A, '/api/friends/entries'));
  const search = await json<{ id: string }[]>(await as(A, '/api/users/search?q=re'));
  const profile = await as(A, '/api/users/ren');
  const list = await as(A, '/api/users/ren/entries');
  const one = await as(A, `/api/users/ren/entries/${bEntry}`);
  const avatar = await as(A, `/api/users/${b}/avatar`);
  const feed = await json<{ items: { userId: string }[] }>(await as(A, '/api/activity?show=everyone'));
  const comments = await json<{ author: { id: string } }[]>(await as(A, `/api/comments?entryId=${aEntry}`));
  const reactions = await json<{ reactions: Record<string, number> }>(await as(A, `/api/reactions?entryId=${aEntry}`));
  const react = await as(A, '/api/reactions', 'POST', { entryId: bEntry, emoji: '❤️' });
  return {
    friend: friends.friends.some((f) => f.id === b),
    entries: entries.some((e) => e.userId === b),
    search: search.some((u) => u.id === b),
    profile: profile.status,
    list: list.status,
    one: one.status,
    avatar: avatar.status,
    feed: feed.items.some((i) => i.userId === b),
    comments: comments.some((c) => c.author.id === b),
    reactions: reactions.reactions['🔥'] ?? 0,
    react: react.status,
  };
}

const VISIBLE = { friend: true, entries: true, search: true, profile: 200, list: 200, one: 200, avatar: 200, feed: true, comments: true, reactions: 1, react: 200 };
const HIDDEN = { friend: false, entries: false, search: false, profile: 404, list: 404, one: 404, avatar: 404, feed: false, comments: false, reactions: 0, react: 404 };

describe('A8: only active users are seen', () => {
  it('an active friend is visible everywhere (baseline)', async () => {
    expect(await seen()).toEqual(VISIBLE);
  });

  it.each(['removed', 'pending'])('a %s friend disappears from friend reads, search, profiles, feed, comments and reactions', async (status) => {
    await setStatus(b, status);
    expect(await seen()).toEqual(HIDDEN);
    // their data stays
    const n = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM entries WHERE user_id = ?1) + (SELECT COUNT(*) FROM friendships WHERE user_b = ?1 OR user_a = ?1) AS n').bind(b).first<{ n: number }>();
    expect(n!.n).toBe(2);
    // restoring brings everything back
    await setStatus(b, 'active');
    expect(await seen()).toEqual({ ...VISIBLE, react: 200 });
  });

  it('a removed friend no longer counts in unread (posts, comments, reactions, friend requests)', async () => {
    const C = 'c@example.com';
    await as(C, '/api/me/username', 'PUT', { username: 'cal' });
    const c = await uid(C);
    await as(C, '/api/friends/requests', 'POST', { username: 'dan' });
    const before = await json<{ feed: number; requests: number }>(await as(A, '/api/activity/unread'));
    expect(before.feed).toBeGreaterThan(0);
    expect(before.requests).toBe(1);
    await setStatus(b, 'removed');
    await setStatus(c, 'removed');
    expect(await json(await as(A, '/api/activity/unread'))).toEqual({ feed: 0, requests: 0 });
  });

  it('an invite code of a non-active user is 404; requests to them are 404', async () => {
    const code = (await json<{ code: string }>(await as(B, '/api/me/invite'))).code;
    await setStatus(b, 'removed');
    expect((await as(A, `/api/friends/code/${code}`)).status).toBe(404);
    expect((await as(A, `/api/friends/add/${code}`, 'POST')).status).toBe(404);
    expect((await as(A, '/api/friends/requests', 'POST', { username: 'ren' })).status).toBe(404);
  });

  it('relationOf is "none" for a non-active owner, in one query', async () => {
    const spy = spyD1(env.DB);
    expect(await relationOf(spy.db, a, b)).toBe('friend');
    expect(spy.queries).toBe(1);
    await setStatus(b, 'removed');
    expect(await relationOf(env.DB, a, b)).toBe('none');
    expect(await relationOf(env.DB, a, 'nobody')).toBe('none');
  });
});
