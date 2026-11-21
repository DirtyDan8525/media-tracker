/**
 * Pictures and GIFs in comments (2026-11-20, migration 0026): the upload (type by magic bytes, 2 MB / GIF 8 MB, the switches and
 * the storage), attaching it to a comment, who may view it (the thread's reading rule), deleting, the daily clean-up and the
 * cap, Delete account, counts, and the notification text.
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Comment } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { forgetAppSettings } from '../src/settings/appSettings';
import { runRetention } from '../src/media/store';

const now = '2026-11-16T12:00:00.000Z';
// O owns the titles (and is the admin). F is O's friend. S is an active stranger. 'pub' has a post, 'bare' has none, 'priv' is private.
const ids = { O: 'uO', F: 'uF', S: 'uS' } as const;
type K = keyof typeof ids;
const email = (k: K) => `${k.toLowerCase()}@example.com`;

const run = (k: K, path: string, init: RequestInit = {}, over: Partial<Env> = {}) =>
  app.fetch(new Request(`https://app.test${path}`, init), { ...env, ...over, ENVIRONMENT: 'dev', DEV_EMAIL: email(k) } as Env);
const as = (k: K, path: string, method = 'GET', body?: unknown, over: Partial<Env> = {}) =>
  run(k, path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, over);

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0]);
const padded = (head: Uint8Array, size: number) => { const b = new Uint8Array(size); b.set(head); return b; };
const upload = (k: K, q: string, bytes: Uint8Array = PNG, type = 'image/png', over: Partial<Env> = {}) =>
  run(k, `/api/comments/media?${q}`, { method: 'POST', headers: { 'content-type': type }, body: bytes as BodyInit }, over);
const mediaId = async (k: K, q: string, bytes?: Uint8Array, type?: string) => ((await (await upload(k, q, bytes, type)).json()) as { mediaId: string }).mediaId;
const post = async (k: K, target: object, extra: object = {}) => as(k, '/api/comments', 'POST', { ...target, ...extra });
const list = async (k: K, q: string) => (await as(k, `/api/comments?${q}`)).json() as Promise<Comment[]>;
const r2Keys = async () => (await env.MEDIA!.list()).objects.map((o) => o.key).sort();
const ledger = () => env.DB.prepare('SELECT key, comment_id, entry_id, user_id, bytes, deleted_at FROM media ORDER BY created_at').all<{ key: string; comment_id: string | null; entry_id: string | null; user_id: string; bytes: number; deleted_at: string | null }>().then((r) => r.results);
const setApp = async (key: string, value: unknown) => {
  expect((await as('O', `/api/admin/app/${key}`, 'PUT', { value })).status).toBe(200);
  forgetAppSettings();
};

const POST = 'activityId=postPub';
const PUB = 'entryId=pub';
const BARE = 'entryId=bare';

beforeEach(async () => {
  const users = (Object.keys(ids) as K[]).map((k) =>
    env.DB.prepare('INSERT INTO users (id, email, username, settings_json, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(ids[k], email(k), k.toLowerCase() + 'name', '{}', k === 'O' ? 1 : 0, now));
  const ent = (id: string, priv: number) =>
    env.DB.prepare(`INSERT INTO entries (id, user_id, category, title, is_private, rating, created_at, updated_at) VALUES (?, 'uO', 'Anime', ?, ?, 8, ?, ?)`).bind(id, id, priv, now, now);
  const act = (id: string, entry: string) =>
    env.DB.prepare(`INSERT INTO activity (id, user_id, entry_id, type, payload_json, post_id, created_at, updated_at) VALUES (?, 'uO', ?, 'rated', '{}', NULL, ?, ?)`).bind(id, entry, now, now);
  await env.DB.batch([
    ...users,
    env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES ('uF', 'uO', 'accepted', 'uO', ?)").bind(now),
    ent('pub', 0), ent('bare', 0), ent('priv', 1),
    act('postPub', 'pub'), act('postPriv', 'priv'),
  ]);
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM comments; DELETE FROM activity; DELETE FROM entries; DELETE FROM friendships; DELETE FROM users; DELETE FROM media; DELETE FROM app_settings;');
  forgetAppSettings();
  const listed = await env.MEDIA!.list();
  if (listed.objects.length) await env.MEDIA!.delete(listed.objects.map((o) => o.key));
});

describe('upload: types and limits (as in chat)', () => {
  it('a PNG, a JPEG-sized photo up to 2 MB and a GIF up to 8 MB are stored and tracked in the ledger', async () => {
    const r = await upload('F', PUB, padded(PNG, 2 * 1024 * 1024));
    expect(r.status).toBe(201);
    const { mediaId: id } = (await r.json()) as { mediaId: string };
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect((await upload('F', PUB, padded(GIF, 8 * 1024 * 1024), 'image/gif')).status).toBe(201);
    const rows = await ledger();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: `cmt/pub/${id}`, comment_id: null, entry_id: 'pub', user_id: 'uF', bytes: 2 * 1024 * 1024 });
    expect(await r2Keys()).toHaveLength(2);
  });

  it('refuses: over 2 MB photo 413, over 8 MB GIF 413, a wrong type 415, a wrong first bytes or a tiny file 400; nothing stored', async () => {
    expect((await upload('F', PUB, padded(PNG, 2 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload('F', PUB, padded(GIF, 8 * 1024 * 1024 + 1), 'image/gif')).status).toBe(413);
    expect((await upload('F', PUB, PNG, 'image/svg+xml')).status).toBe(415);
    expect((await upload('F', PUB, PNG, 'text/plain')).status).toBe(415);
    expect((await upload('F', PUB, PNG, 'audio/webm')).status).toBe(415);
    expect((await upload('F', PUB, GIF, 'image/png')).status).toBe(400);
    expect((await upload('F', PUB, PNG.slice(0, 5))).status).toBe(400);
    expect((await upload('F', '')).status).toBe(400);
    expect(await r2Keys()).toEqual([]);
    expect(await ledger()).toEqual([]);
  });

  it('needs the Comments and Photos switches and the storage', async () => {
    await setApp('features', { photos: false });
    expect((await upload('F', PUB)).status).toBe(403);
    await setApp('features', { photos: true, comments: false });
    expect((await upload('F', PUB)).status).toBe(403);
    await setApp('features', { comments: true });
    expect((await upload('F', PUB, PNG, 'image/png', { MEDIA: undefined })).status).toBe(503);
    expect((await upload('F', PUB)).status).toBe(201);
    expect(await r2Keys()).toHaveLength(1);
  });

  it('a switched-off Photos refuses to attach a picture uploaded before', async () => {
    const id = await mediaId('F', PUB);
    await setApp('features', { photos: false });
    expect((await post('F', { entryId: 'pub' }, { mediaId: id })).status).toBe(403);
  });
});

describe('comments with a picture', () => {
  it('a picture alone is a comment (text optional); with text too; the list and the count include them', async () => {
    const id1 = await mediaId('F', PUB);
    const res = await post('F', { entryId: 'pub' }, { mediaId: id1 });
    expect(res.status).toBe(201);
    const c1 = (await res.json()) as Comment;
    expect(c1).toMatchObject({ body: '', image: true, expired: false, canDelete: true });
    const id2 = await mediaId('S', POST, GIF, 'image/gif');
    const c2 = (await (await post('S', { activityId: 'postPub' }, { body: '  lol  ', mediaId: id2 })).json()) as Comment;
    expect(c2).toMatchObject({ body: 'lol', image: true });
    await post('O', { entryId: 'pub' }, { body: 'plain' });
    const got = await list('O', PUB);
    expect(got.map((c) => [c.body, c.image])).toEqual([['', true], ['lol', true], ['plain', false]]);
    expect(await (await as('O', '/api/reactions?entryId=pub')).json()).toMatchObject({ comments: 3 });
    expect((await ledger()).map((r) => r.comment_id).sort()).toEqual([c1.id, c2.id].sort());
    // The activity feed counts them as normal comments.
    const feed = (await (await as('O', '/api/activity')).json()) as { social: Record<string, { comments: number }> };
    expect(Object.values(feed.social).map((s) => s.comments)).toContain(3);
  });

  it('no text and no picture is 400; a picture id that is someone else\'s, for another title, used already or made up is 400', async () => {
    expect((await post('F', { entryId: 'pub' }, {})).status).toBe(400);
    expect((await post('F', { entryId: 'pub' }, { body: '   ' })).status).toBe(400);
    const mine = await mediaId('F', PUB);
    expect((await post('S', { activityId: 'postPub' }, { mediaId: mine })).status).toBe(400);
    expect((await post('F', { entryId: 'bare' }, { mediaId: mine })).status).toBe(400);
    expect((await post('F', { entryId: 'pub' }, { mediaId: 'f'.repeat(32) })).status).toBe(400);
    expect((await post('F', { entryId: 'pub' }, { mediaId: '../x' })).status).toBe(400);
    expect((await post('F', { entryId: 'pub' }, { mediaId: mine })).status).toBe(201);
    expect((await post('F', { entryId: 'pub' }, { mediaId: mine })).status).toBe(400);
    expect((await post('F', { entryId: 'pub' }, { body: 'x'.repeat(501), mediaId: await mediaId('F', PUB) })).status).toBe(400);
  });
});

describe('who can view the picture (the thread\'s reading rule)', () => {
  const view = (k: K, id: string) => as(k, `/api/comments/${id}/media`);

  it('through a post: the owner, a friend and an active stranger all see it; bytes, type and a private cache', async () => {
    const c = (await (await post('F', { activityId: 'postPub' }, { mediaId: await mediaId('F', POST, GIF, 'image/gif') })).json()) as Comment;
    for (const k of ['O', 'F', 'S'] as const) {
      const res = await view(k, c.id);
      expect(res.status, k).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/gif');
      expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(GIF);
    }
  });

  it('a comment on a title with no post: friends only, a stranger gets 404 (and cannot upload to it either)', async () => {
    expect((await upload('S', BARE)).status).toBe(404);
    const c = (await (await post('F', { entryId: 'bare' }, { mediaId: await mediaId('F', BARE) })).json()) as Comment;
    expect((await view('O', c.id)).status).toBe(200);
    expect((await view('F', c.id)).status).toBe(200);
    expect((await view('S', c.id)).status).toBe(404);
  });

  it('a private title: its owner and the admin only; a friend or stranger gets 404 for the file and for the upload', async () => {
    expect((await upload('F', 'entryId=priv')).status).toBe(404);
    expect((await upload('S', 'activityId=postPriv')).status).toBe(404);
    const c = (await (await post('O', { entryId: 'priv' }, { mediaId: await mediaId('O', 'entryId=priv') })).json()) as Comment;
    expect((await view('O', c.id)).status).toBe(200);
    expect((await view('F', c.id)).status).toBe(404);
    expect((await view('S', c.id)).status).toBe(404);
  });

  it('a comment without a picture, a made-up id, and a removed author are 404', async () => {
    const plain = (await (await post('F', { entryId: 'pub' }, { body: 'hi' })).json()) as Comment;
    expect((await view('O', plain.id)).status).toBe(404);
    expect((await view('O', 'nope')).status).toBe(404);
    const c = (await (await post('F', { entryId: 'pub' }, { mediaId: await mediaId('F', PUB) })).json()) as Comment;
    await env.DB.exec("UPDATE users SET status = 'removed' WHERE id = 'uF'");
    expect((await view('O', c.id)).status).toBe(404);
  });
});

describe('deleting', () => {
  it('deleting the comment (its author, or the title\'s owner) deletes the file; the picture is gone for everyone', async () => {
    const c1 = (await (await post('F', { entryId: 'pub' }, { mediaId: await mediaId('F', PUB) })).json()) as Comment;
    const c2 = (await (await post('F', { entryId: 'pub' }, { mediaId: await mediaId('F', PUB) })).json()) as Comment;
    expect(await r2Keys()).toHaveLength(2);
    expect((await as('S', `/api/comments/${c1.id}`, 'DELETE')).status).toBe(403);
    expect((await as('F', `/api/comments/${c1.id}`, 'DELETE')).status).toBe(204);
    expect(await r2Keys()).toHaveLength(1);
    expect((await as('O', `/api/comments/${c2.id}`, 'DELETE')).status).toBe(204);
    expect(await r2Keys()).toEqual([]);
    expect((await ledger()).every((r) => r.deleted_at !== null)).toBe(true);
    expect((await as('O', `/api/comments/${c1.id}/media`)).status).toBe(404);
    expect(await list('O', PUB)).toEqual([]);
  });
});

describe('clean-up and the cap', () => {
  it('the age rule removes the file; the comment stays and reads expired', async () => {
    await setApp('media', { retentionMonths: 1, capMb: 300 });
    const old = (await (await post('F', { entryId: 'pub' }, { body: 'old', mediaId: await mediaId('F', PUB) })).json()) as Comment;
    const fresh = (await (await post('F', { entryId: 'pub' }, { mediaId: await mediaId('F', PUB) })).json()) as Comment;
    await env.DB.prepare("UPDATE media SET created_at = '2026-01-01T00:00:00.000Z' WHERE comment_id = ?").bind(old.id).run();
    const report = await runRetention(env);
    expect(report.aged).toBe(1);
    expect(await r2Keys()).toHaveLength(1);
    const got = await list('O', PUB);
    expect(got.find((c) => c.id === old.id)).toMatchObject({ body: 'old', image: false, expired: true });
    expect(got.find((c) => c.id === fresh.id)).toMatchObject({ image: true, expired: false });
    expect((await as('O', `/api/comments/${old.id}/media`)).status).toBe(404);
  });

  it('removes orphans: a picture never attached (after an hour) and one whose comment is gone', async () => {
    const pending = await mediaId('F', PUB);
    const c = (await (await post('F', { entryId: 'pub' }, { mediaId: await mediaId('F', PUB) })).json()) as Comment;
    expect(await runRetention(env, new Date(Date.now() + 30 * 60_000))).toMatchObject({ orphaned: 0 });
    expect(await runRetention(env, new Date(Date.now() + 2 * 3_600_000))).toMatchObject({ orphaned: 1 });
    expect(await r2Keys()).toEqual([expect.not.stringContaining(pending)]);
    // The title is deleted: its comments cascade away, their files are found by the ledger.
    await env.DB.exec("DELETE FROM entries WHERE id = 'pub'");
    expect(await runRetention(env, new Date(Date.now() + 2 * 3_600_000))).toMatchObject({ orphaned: 1 });
    expect(await r2Keys()).toEqual([]);
    expect(c.id).toBeTruthy();
  });

  it('the per-person cap counts comment pictures: an upload that would pass it removes that person\'s oldest file first', async () => {
    await setApp('media', { retentionMonths: 6, capMb: 10 });
    const two = padded(PNG, 2 * 1024 * 1024);
    const mine: Comment[] = [];
    for (let i = 0; i < 5; i++) {
      mine.push((await (await post('F', { entryId: 'pub' }, { mediaId: await mediaId('F', PUB, two) })).json()) as Comment);
      await env.DB.prepare('UPDATE media SET created_at = ? WHERE comment_id = ?').bind(`2026-11-0${i + 1}T00:00:00.000Z`, mine[i]!.id).run();
    }
    const other = (await (await post('S', { activityId: 'postPub' }, { mediaId: await mediaId('S', POST) })).json()) as Comment; // someone else's: untouched
    expect((await list('O', PUB)).filter((c) => c.expired)).toHaveLength(0);
    expect((await upload('F', PUB, two)).status).toBe(201); // 10 MB held + 2 MB more: the oldest goes
    const got = await list('O', PUB);
    expect(got.find((c) => c.id === mine[0]!.id)).toMatchObject({ image: false, expired: true });
    expect(got.filter((c) => c.expired)).toHaveLength(1);
    expect(got.find((c) => c.id === other.id)).toMatchObject({ image: true });
  });

  it('admin Delete account removes the person\'s comment pictures from R2 and the ledger counts', async () => {
    await post('F', { entryId: 'pub' }, { mediaId: await mediaId('F', PUB) });
    await post('S', { activityId: 'postPub' }, { mediaId: await mediaId('S', POST) });
    expect(await (await as('O', '/api/admin/media')).json()).toMatchObject({ files: 2 });
    expect((await as('O', '/api/admin/users/uF/delete', 'POST')).status).toBe(204);
    expect(await r2Keys()).toHaveLength(1);
    expect(await (await as('O', '/api/admin/media')).json()).toMatchObject({ files: 1 });
  });
});
