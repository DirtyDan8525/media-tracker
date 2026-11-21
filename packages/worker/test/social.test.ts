import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Comment, PostSocial } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { spyD1 } from './d1spy';

const now = '2026-11-16T12:00:00.000Z';
// O owns the entries. F is O's friend, G is O's friend too (third friend), S a stranger, P pending.
const ids = { O: 'uO', F: 'uF', G: 'uG', S: 'uS', P: 'uP' } as const;
const email = (k: keyof typeof ids) => `${k.toLowerCase()}@example.com`;

const as = (k: keyof typeof ids, path: string, method = 'GET', body?: unknown, db: D1Database = env.DB) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, DB: db, ENVIRONMENT: 'dev', DEV_EMAIL: email(k) } as Env,
  );

const fr = (a: string, b: string, status: string, by: string) => {
  const [x, y] = a < b ? [a, b] : [b, a];
  return env.DB.prepare('INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(x, y, status, by, now);
};

beforeEach(async () => {
  const users = (Object.keys(ids) as (keyof typeof ids)[]).map((k) =>
    env.DB.prepare('INSERT INTO users (id, email, username, settings_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(ids[k], email(k), k.toLowerCase() + 'name', '{}', now));
  const ent = (id: string, priv: number) =>
    env.DB.prepare(`INSERT INTO entries (id, user_id, category, title, is_private, rating, created_at, updated_at)
      VALUES (?, 'uO', 'Anime', ?, ?, 8, ?, ?)`).bind(id, id, priv, now, now);
  const act = (id: string, entry: string, postId: string | null) =>
    env.DB.prepare(`INSERT INTO activity (id, user_id, entry_id, type, payload_json, post_id, created_at, updated_at)
      VALUES (?, 'uO', ?, 'rated', '{}', ?, ?, ?)`).bind(id, entry, postId, now, now);
  await env.DB.batch([
    ...users,
    fr('uO', 'uF', 'accepted', 'uO'),
    fr('uO', 'uG', 'accepted', 'uO'),
    fr('uO', 'uP', 'pending', 'uP'),
    ent('pub', 0),
    ent('priv', 1),
    act('postPub', 'pub', null),
    act('postPubChild', 'pub', 'postPub'),
    act('postPriv', 'priv', null),
  ]);
});

afterEach(async () => {
  await env.DB.exec('DELETE FROM reactions; DELETE FROM comments; DELETE FROM activity; DELETE FROM entries; DELETE FROM friendships; DELETE FROM users;');
});

const react = (k: keyof typeof ids, target: object, emoji: unknown = '❤️', db?: D1Database) =>
  as(k, '/api/reactions', 'POST', { ...target, emoji }, db);
const comment = (k: keyof typeof ids, target: object, body: unknown, db?: D1Database) =>
  as(k, '/api/comments', 'POST', { ...target, body }, db);
const list = async (k: keyof typeof ids, q: string) => (await as(k, `/api/comments?${q}`)).json() as Promise<Comment[]>;

const post = { activityId: 'postPub' };
const entry = { entryId: 'pub' };

describe('reactions', () => {
  it('friend reacts, then again toggles it off', async () => {
    const r1 = await react('F', post);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ reactions: { '❤️': 1 }, mine: ['❤️'], comments: 0 } satisfies PostSocial);
    const r2 = await react('F', post);
    expect(await r2.json()).toEqual({ reactions: {}, mine: [], comments: 0 });
  });

  it('counts several people and reports only my own as mine; GET by entry matches', async () => {
    await react('F', entry);
    await react('G', entry, '🔥');
    await react('O', entry, '🔥');
    const res = await as('F', '/api/reactions?entryId=pub');
    expect(await res.json()).toEqual({ reactions: { '❤️': 1, '🔥': 2 }, mine: ['❤️'], comments: 0 });
  });

  it('400 for anything that is not exactly one emoji', async () => {
    for (const bad of ['a', '1', '❤️❤️', '', 'hi 👍', 'x'.repeat(40), 5, null]) {
      expect((await react('F', post, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('accepts any single emoji, stores it, and dedupes per user + emoji', async () => {
    for (const e of ['💩', '👍🏽', '🏳️‍🌈', '🇯🇵']) {
      expect((await react('F', post, e)).status, e).toBe(200);
    }
    const res = await as('G', '/api/reactions?activityId=postPub');
    expect(await res.json()).toEqual({ reactions: { '💩': 1, '👍🏽': 1, '🏳️‍🌈': 1, '🇯🇵': 1 }, mine: [], comments: 0 });
    // The same emoji again toggles it off (one row per user + emoji); a second user adds to the count.
    await react('G', post, '💩');
    expect(await (await as('G', '/api/reactions?activityId=postPub')).json()).toMatchObject({ reactions: { '💩': 2 }, mine: ['💩'] });
    await react('F', post, '💩');
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM reactions WHERE emoji = '💩'").first<{ n: number }>();
    expect(rows!.n).toBe(1);
    await expect(
      env.DB.prepare("INSERT INTO reactions (id, entry_id, user_id, emoji, created_at) VALUES ('dup', 'pub', 'uG', '💩', ?)").bind(now).run(),
    ).rejects.toThrow();
  });

  it('400 when both or neither target is given', async () => {
    expect((await react('F', { activityId: 'postPub', entryId: 'pub' })).status).toBe(400);
    expect((await react('F', {})).status).toBe(400);
    expect((await as('F', '/api/reactions')).status).toBe(400);
    expect((await as('F', '/api/comments')).status).toBe(400);
  });

  it('only anchor post ids are accepted', async () => {
    expect((await react('F', { activityId: 'postPubChild' })).status).toBe(404);
    expect((await react('F', { activityId: 'nope' })).status).toBe(404);
  });
});

describe('GET /reactions/who', () => {
  type Who = { emoji: string; users: { id: string; username: string; displayName: string | null; avatarAt: string | null }[] }[];
  const put = (id: string, ent: string, user: string, emoji: string, at: string) =>
    env.DB.prepare('INSERT INTO reactions (id, entry_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, ent, user, emoji, at);

  it('groups by emoji: most first, ties by first reaction; people oldest first', async () => {
    await env.DB.batch([
      put('r1', 'pub', 'uF', '🔥', '2026-11-16T12:00:01.000Z'),
      put('r2', 'pub', 'uG', '❤️', '2026-11-16T12:00:02.000Z'),
      put('r3', 'pub', 'uO', '❤️', '2026-11-16T12:00:03.000Z'),
      put('r4', 'pub', 'uG', '👏', '2026-11-16T12:00:04.000Z'),
      put('r5', 'pub', 'uF', '👏', '2026-11-16T12:00:05.000Z'),
      put('r6', 'pub', 'uF', '❤️', '2026-11-16T12:00:06.000Z'),
      put('r7', 'pub', 'uG', '🎉', '2026-11-16T12:00:00.500Z'),
    ]);
    const res = await as('F', '/api/reactions/who?activityId=postPub');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Who;
    // ❤️ has 3, 👏 has 2, then the two singles by who came first.
    expect(body.map((g) => [g.emoji, g.users.map((u) => u.id)])).toEqual([
      ['❤️', ['uG', 'uO', 'uF']],
      ['👏', ['uG', 'uF']],
      ['🎉', ['uG']], // ties on 1: 🎉 reacted first (:00.5)
      ['🔥', ['uF']],
    ]);
    expect(body[0]!.users[0]).toEqual({ id: 'uG', username: 'gname', displayName: null, avatarAt: null });
  });

  it('works for an entry, leaves out removed people, and answers [] with no reactions', async () => {
    expect(await (await as('F', '/api/reactions/who?entryId=pub')).json()).toEqual([]);
    await env.DB.batch([
      put('r1', 'pub', 'uF', '🔥', '2026-11-16T12:00:01.000Z'),
      put('r2', 'pub', 'uG', '🔥', '2026-11-16T12:00:02.000Z'),
    ]);
    await env.DB.exec("UPDATE users SET status = 'removed' WHERE id = 'uG'");
    const body = (await (await as('O', '/api/reactions/who?entryId=pub')).json()) as Who;
    expect(body).toEqual([{ emoji: '🔥', users: [{ id: 'uF', username: 'fname', displayName: null, avatarAt: null }] }]);
  });

  it('is hidden like the reactions route: not visible or missing is 404, a bad target 400', async () => {
    await env.DB.batch([put('r1', 'priv', 'uO', '🔥', now)]);
    expect((await as('F', '/api/reactions/who?activityId=postPriv')).status).toBe(404);
    expect((await as('S', '/api/reactions/who?entryId=priv')).status).toBe(404);
    expect((await as('S', '/api/reactions/who?entryId=pub')).status).toBe(404); // entry targets are friends-only
    expect((await as('F', '/api/reactions/who?activityId=nope')).status).toBe(404);
    expect((await as('F', '/api/reactions/who?activityId=postPubChild')).status).toBe(404); // not an anchor
    expect((await as('F', '/api/reactions/who')).status).toBe(400);
    expect((await as('F', '/api/reactions/who?activityId=postPub&entryId=pub')).status).toBe(400);
  });

  it('stays within 4 D1 queries (sign-in 1 + target 1-2 + reactions 1)', async () => {
    await env.DB.batch([put('r1', 'pub', 'uG', '🔥', now), put('r2', 'pub', 'uF', '🔥', now)]);
    for (const q of ['activityId=postPub', 'entryId=pub']) {
      const spy = spyD1(env.DB);
      expect((await as('F', `/api/reactions/who?${q}`, 'GET', undefined, spy.db)).status).toBe(200);
      expect(spy.queries).toBeLessThanOrEqual(4);
    }
  });
});

describe('visibility of the thread', () => {
  it.each(['S', 'P'] as const)('%s (stranger / pending) gets 404 on the entry thread but may react, list and comment on the post (Dan 2026-11-16)', async (k) => {
    expect((await react(k, entry)).status).toBe(404);
    expect((await comment(k, entry, 'hi')).status).toBe(404);
    expect((await as(k, '/api/comments?entryId=pub')).status).toBe(404);
    expect((await as(k, '/api/reactions?entryId=pub')).status).toBe(404);
    expect((await react(k, post)).status).toBe(200);
    expect((await comment(k, post, 'hi')).status).toBe(201);
    expect((await as(k, '/api/comments?activityId=postPub')).status).toBe(200);
    expect((await as(k, '/api/reactions?activityId=postPub')).status).toBe(200);
  });

  it("a stranger never reaches a private entry's post, nor a removed or pending user's post", async () => {
    expect((await react('S', { activityId: 'postPriv' })).status).toBe(404);
    expect((await comment('S', { activityId: 'postPriv' }, 'hi')).status).toBe(404);
    await env.DB.exec("UPDATE users SET status = 'removed' WHERE id = 'uO'");
    expect((await react('S', post)).status).toBe(404);
    expect((await as('S', '/api/comments?activityId=postPub')).status).toBe(404);
    await env.DB.exec("UPDATE users SET status = 'pending' WHERE id = 'uO'");
    expect((await react('S', post)).status).toBe(404);
  });

  it("a stranger can delete their own comment on a post, not someone else's", async () => {
    const mine = (await (await comment('S', post, 'a')).json()) as Comment;
    const theirs = (await (await comment('F', post, 'b')).json()) as Comment;
    expect((await as('S', `/api/comments/${theirs.id}`, 'DELETE')).status).toBe(403);
    expect((await as('S', `/api/comments/${mine.id}`, 'DELETE')).status).toBe(204);
  });

  it('a post resolves in one query, even for a stranger', async () => {
    const spy = spyD1(env.DB);
    expect((await react('S', post, '❤️', spy.db)).status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(6);
  });

  it("a private entry's post and entry: 404 for the friend, 200 for the owner", async () => {
    for (const t of [{ activityId: 'postPriv' }, { entryId: 'priv' }]) {
      expect((await react('F', t)).status).toBe(404);
      expect((await comment('F', t, 'hi')).status).toBe(404);
      expect((await react('O', t)).status).toBe(200);
      expect((await comment('O', t, 'mine')).status).toBe(201);
    }
  });

  it('entry turned private after friends reacted: friend loses the thread at once, owner keeps it', async () => {
    await comment('F', entry, 'nice');
    await env.DB.exec("UPDATE entries SET is_private = 1 WHERE id = 'pub'");
    expect((await as('F', '/api/comments?entryId=pub')).status).toBe(404);
    expect((await as('O', '/api/comments?entryId=pub')).status).toBe(200);
  });

  it('unfriending cuts the entry thread but the post stays open to the ex-friend (Everyone)', async () => {
    await comment('F', entry, 'hello');
    expect((await as('F', '/api/comments?entryId=pub')).status).toBe(200);
    await env.DB.exec("DELETE FROM friendships WHERE user_a = 'uF' OR user_b = 'uF'");
    expect((await as('F', '/api/comments?entryId=pub')).status).toBe(404);
    expect((await as('F', '/api/comments?activityId=postPub')).status).toBe(200);
  });
});

describe('comments', () => {
  it('rejects blank and over-long bodies; trims and accepts exactly 500', async () => {
    expect((await comment('F', post, '  ')).status).toBe(400);
    expect((await comment('F', post, 'x'.repeat(501))).status).toBe(400);
    expect((await comment('F', post, 42)).status).toBe(400);
    const ok = await comment('F', post, `  ${'y'.repeat(500)}  `);
    expect(ok.status).toBe(201);
    const c = (await ok.json()) as Comment;
    expect(c.body).toBe('y'.repeat(500));
    expect(c.author).toMatchObject({ id: 'uF', username: 'fname' });
    expect(c.canDelete).toBe(true);
  });

  it('lists oldest first with canDelete for author and entry owner only', async () => {
    const a = (await (await comment('F', post, 'first')).json()) as Comment;
    const b = (await (await comment('G', post, 'second')).json()) as Comment;
    await env.DB.prepare("UPDATE comments SET created_at = '2026-11-16T12:00:09.000Z' WHERE id = ?").bind(b.id).run();
    await env.DB.prepare("UPDATE comments SET created_at = '2026-11-16T12:00:01.000Z' WHERE id = ?").bind(a.id).run();
    const asF = await list('F', 'activityId=postPub');
    expect(asF.map((c) => c.body)).toEqual(['first', 'second']);
    expect(asF.map((c) => c.canDelete)).toEqual([true, false]);
    expect((await list('O', 'activityId=postPub')).map((c) => c.canDelete)).toEqual([true, true]);
  });

  it('comment counts show in PostSocial', async () => {
    await comment('F', post, 'one');
    const res = await as('G', '/api/reactions?activityId=postPub');
    expect(await res.json()).toMatchObject({ comments: 1 });
  });

  it('caps a list at 200', async () => {
    const stmts = Array.from({ length: 205 }, (_, i) =>
      env.DB.prepare("INSERT INTO comments (id, entry_id, user_id, body, created_at) VALUES (?, 'pub', 'uF', 'c', ?)")
        .bind(`c${i}`, `2026-11-16T12:00:00.${String(i).padStart(3, '0')}Z`));
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    expect(await list('F', 'entryId=pub')).toHaveLength(200);
  });

  it('delete: author 204, entry owner 204, a third friend 403, a stranger 403 (the post is open)', async () => {
    const mine = (await (await comment('F', post, 'a')).json()) as Comment;
    const theirs = (await (await comment('F', post, 'b')).json()) as Comment;
    expect((await as('G', `/api/comments/${theirs.id}`, 'DELETE')).status).toBe(403);
    expect((await as('S', `/api/comments/${theirs.id}`, 'DELETE')).status).toBe(403); // a stranger sees the post, not their comment to delete
    expect((await as('F', `/api/comments/${mine.id}`, 'DELETE')).status).toBe(204);
    expect((await as('O', `/api/comments/${theirs.id}`, 'DELETE')).status).toBe(204);
    expect((await as('O', `/api/comments/${theirs.id}`, 'DELETE')).status).toBe(404);
    expect((await as('O', '/api/comments/missing', 'DELETE')).status).toBe(404);
  });

  it('deleted comments are not listed or counted, but the row is kept (soft delete)', async () => {
    const c = (await (await comment('F', post, 'bye')).json()) as Comment;
    await comment('G', post, 'stay');
    await as('F', `/api/comments/${c.id}`, 'DELETE');
    expect((await list('O', 'activityId=postPub')).map((x) => x.body)).toEqual(['stay']);
    expect(await (await as('O', '/api/reactions?activityId=postPub')).json()).toMatchObject({ comments: 1 });
    const row = await env.DB.prepare('SELECT deleted_at FROM comments WHERE id = ?').bind(c.id).first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).not.toBeNull();
  });

  it('delete: a stranger who commented on a private-again post cannot delete it (404)', async () => {
    const c = (await (await comment('S', post, 'x')).json()) as Comment;
    await env.DB.exec("UPDATE entries SET is_private = 1 WHERE id = 'pub'");
    expect((await as('S', `/api/comments/${c.id}`, 'DELETE')).status).toBe(404);
  });

  it('a friend who can no longer see the entry cannot delete (404)', async () => {
    const c = (await (await comment('F', entry, 'x')).json()) as Comment;
    await env.DB.exec("UPDATE entries SET is_private = 1 WHERE id = 'pub'");
    expect((await as('F', `/api/comments/${c.id}`, 'DELETE')).status).toBe(404);
  });
});

// Dan 2026-11-20 (migration 0025): a post's reactions and comments ARE its title's, one-to-one, both ways.
describe('one thread per title: a post and its title share reactions and comments', () => {
  it('a reaction on a post shows on the title page (and who reacted), and one on the title page shows on the post', async () => {
    await react('F', post, '🔥');
    await react('G', entry, '❤️');
    for (const q of ['activityId=postPub', 'entryId=pub']) {
      expect(await (await as('O', `/api/reactions?${q}`)).json()).toEqual({ reactions: { '🔥': 1, '❤️': 1 }, mine: [], comments: 0 });
      const who = (await (await as('O', `/api/reactions/who?${q}`)).json()) as { emoji: string; users: { id: string }[] }[];
      expect(who.map((g) => [g.emoji, g.users.map((u) => u.id)])).toEqual([['🔥', ['uF']], ['❤️', ['uG']]]);
    }
    const stored = await env.DB.prepare('SELECT entry_id, user_id, emoji FROM reactions ORDER BY emoji').all();
    expect(stored.results).toEqual([{ entry_id: 'pub', user_id: 'uG', emoji: '❤️' }, { entry_id: 'pub', user_id: 'uF', emoji: '🔥' }]);
  });

  it('the same emoji from the title page toggles off the one left on the post (one per person per emoji per title)', async () => {
    expect(await (await react('F', post, '🔥')).json()).toMatchObject({ reactions: { '🔥': 1 }, mine: ['🔥'] });
    expect(await (await react('F', entry, '🔥')).json()).toEqual({ reactions: {}, mine: [], comments: 0 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM reactions').first<{ n: number }>())!.n).toBe(0);
  });

  it('comments both ways: one thread, the same list and count from the post and the title page', async () => {
    const a = (await (await comment('F', post, 'from the post')).json()) as Comment;
    await env.DB.prepare("UPDATE comments SET created_at = '2026-11-16T12:00:01.000Z' WHERE id = ?").bind(a.id).run();
    await comment('G', entry, 'from the page');
    for (const q of ['activityId=postPub', 'entryId=pub']) {
      expect((await list('O', q)).map((c) => c.body)).toEqual(['from the post', 'from the page']);
      expect(await (await as('F', `/api/reactions?${q}`)).json()).toMatchObject({ comments: 2 });
    }
    // Deleted from the title page: gone from the post too.
    expect((await as('O', `/api/comments/${a.id}`, 'DELETE')).status).toBe(204);
    expect((await list('F', 'activityId=postPub')).map((c) => c.body)).toEqual(['from the page']);
  });

  it("a stranger who reaches the title through its post sees and adds to the title's thread; the title page stays friends-only", async () => {
    await comment('F', entry, 'friend on the page');
    await react('F', entry, '🔥');
    expect((await list('S', 'activityId=postPub')).map((c) => c.body)).toEqual(['friend on the page']);
    expect(await (await react('S', post, '👍')).json()).toMatchObject({ reactions: { '🔥': 1, '👍': 1 }, mine: ['👍'] });
    expect((await as('S', '/api/reactions?entryId=pub')).status).toBe(404);
    // The owner and friends see the stranger's reaction on the title page.
    expect(await (await as('F', '/api/reactions?entryId=pub')).json()).toMatchObject({ reactions: { '🔥': 1, '👍': 1 } });
  });

  it("a private title: neither its post nor its page lets a friend or a stranger see or add; the owner's own reaction on the post is on the page", async () => {
    expect((await react('O', { activityId: 'postPriv' }, '🔥')).status).toBe(200);
    for (const k of ['F', 'S'] as const) {
      for (const q of ['activityId=postPriv', 'entryId=priv']) {
        expect((await as(k, `/api/reactions?${q}`)).status).toBe(404);
        expect((await as(k, `/api/comments?${q}`)).status).toBe(404);
        expect((await as(k, `/api/reactions/who?${q}`)).status).toBe(404);
      }
      expect((await react(k, { entryId: 'priv' })).status).toBe(404);
      expect((await comment(k, { activityId: 'postPriv' }, 'x')).status).toBe(404);
    }
    expect(await (await as('O', '/api/reactions?entryId=priv')).json()).toMatchObject({ reactions: { '🔥': 1 }, mine: ['🔥'] });
  });
});

describe('query counts (each route states its count; <= 6)', () => {
  it('every route stays within 6 D1 queries', async () => {
    const run = async (fn: (db: D1Database) => Promise<Response> | Response) => {
      const spy = spyD1(env.DB);
      const res = await fn(spy.db);
      expect(spy.queries).toBeLessThanOrEqual(6);
      return { res, spy };
    };
    // sign-in is 1 query for an existing user; it is counted here too.
    const a = await run((db) => react('F', post, '❤️', db)); // toggle on
    const b = await run((db) => react('F', post, '❤️', db)); // toggle off
    const c = await run((db) => as('F', '/api/reactions?activityId=postPub', 'GET', undefined, db));
    const d = await run((db) => comment('F', post, 'hi', db));
    const e = await run((db) => as('F', '/api/comments?activityId=postPub', 'GET', undefined, db));
    const id = ((await d.res.json()) as Comment).id;
    const f = await run((db) => as('O', `/api/comments/${id}`, 'DELETE', undefined, db));
    for (const x of [a, b, c, d, e, f]) expect(x.res.status).toBeLessThan(300);
  });
});
