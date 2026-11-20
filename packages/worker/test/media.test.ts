/**
 * Photos and voice memos in chats (2026-11-20): uploads (switches, type by magic bytes, size, length, membership), serving
 * (members only, private cache, byte ranges), retention (the scheduled handler with a moved clock: age and per-person cap;
 * the cap at upload time; orphans), expired display, the admin's numbers and Delete account, Recent emoji in chat reactions,
 * the /api/app capability, and the 0021 table rebuild.
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker, { app } from '../src/index';
import type { Env } from '../src/env';
import type { Conversation, Message, MessagePage } from '@media-tracker/shared';
import { forgetAppSettings } from '../src/settings/appSettings';
import { monthsBefore, runRetention } from '../src/media/store';
import { spyD1 } from './d1spy';

const A = 'a@example.com';
const B = 'b@example.com';
const D = 'd@example.com';

const run = (email: string, path: string, init: RequestInit, over: Partial<Env> = {}) =>
  app.fetch(new Request(`https://app.test${path}`, init), { ...env, ...over, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env);
const as = (email: string, path: string, method = 'GET', body?: unknown, over: Partial<Env> = {}) =>
  run(email, path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, over);
const json = async <T = any>(res: Response) => (await res.json()) as T;
const uid = async (email: string) => (await json<{ id: string }>(await as(email, '/api/me'))).id;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81, 1, 2, 3, 4]);
const MP4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]);
const OGG = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);

const padded = (head: Uint8Array, size: number) => { const b = new Uint8Array(size); b.set(head); return b; };
const photo = (email: string, conv: string, bytes: Uint8Array = PNG, type = 'image/png', over: Partial<Env> = {}) =>
  run(email, `/api/conversations/${conv}/messages/image`, { method: 'POST', headers: { 'content-type': type }, body: bytes as BodyInit }, over);
const voice = (email: string, conv: string, bytes: Uint8Array = WEBM, type = 'audio/webm;codecs=opus', ms: number | string = 4200, over: Partial<Env> = {}) =>
  run(email, `/api/conversations/${conv}/messages/voice?ms=${ms}`, { method: 'POST', headers: { 'content-type': type }, body: bytes as BodyInit }, over);
const page = async (email: string, conv: string) => json<MessagePage>(await as(email, `/api/conversations/${conv}/messages`));
const setApp = async (key: string, value: unknown) => {
  expect((await as(A, `/api/admin/app/${key}`, 'PUT', { value })).status).toBe(200);
  forgetAppSettings();
};
const keyOf = async (messageId: string) =>
  (await env.DB.prepare('SELECT image_key FROM messages WHERE id = ?').bind(messageId).first<{ image_key: string | null }>())?.image_key ?? null;
const r2Keys = async () => (await env.MEDIA!.list()).objects.map((o) => o.key).sort();

let a: string, b: string;
let dm: string;

beforeEach(async () => {
  // A is the admin (first account with is_admin set below); A and B are friends; D is a stranger.
  for (const [email, name] of [[A, 'dan'], [B, 'ren'], [D, 'dax']] as const) {
    expect((await as(email, '/api/me/username', 'PUT', { username: name })).status).toBe(200);
  }
  [a, b] = [await uid(A), await uid(B)];
  await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(a).run();
  await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
  expect((await as(B, `/api/friends/${a}/accept`, 'POST')).status).toBe(204);
  const res = await as(A, '/api/conversations', 'POST', { userIds: [b] });
  dm = (await json<Conversation>(res)).id;
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
  await env.DB.exec('DELETE FROM media');
  await env.DB.exec('DELETE FROM app_settings');
  forgetAppSettings();
  const listed = await env.MEDIA!.list();
  if (listed.objects.length) await env.MEDIA!.delete(listed.objects.map((o) => o.key));
});

describe('migration 0021: messages rebuilt for voice memos', () => {
  it('keeps reply_to pointing at messages (set null on delete) and accepts the voice kind', async () => {
    const fks = (await env.DB.prepare("SELECT \"table\", \"from\", on_delete FROM pragma_foreign_key_list('messages')").all<{ table: string; from: string; on_delete: string }>()).results;
    expect(fks).toContainEqual({ table: 'messages', from: 'reply_to', on_delete: 'SET NULL' });
    const idx = (await env.DB.prepare("SELECT name FROM pragma_index_list('messages')").all<{ name: string }>()).results.map((r) => r.name);
    for (const n of ['idx_messages_conv_created_id', 'idx_messages_sender', 'idx_messages_rec', 'idx_messages_deleted', 'idx_messages_reply_to']) expect(idx).toContain(n);
    const r = await voice(A, dm);
    expect(r.status).toBe(201);
  });
});

describe('voice memos', () => {
  it('webm, mp4 and ogg are stored with their length; members get them back; the page shows play data', async () => {
    for (const [bytes, type] of [[WEBM, 'audio/webm;codecs=opus'], [MP4, 'audio/mp4'], [OGG, 'audio/ogg']] as const) {
      const res = await voice(A, dm, bytes, type, 3000);
      expect(res.status).toBe(201);
      const m = await json<Message>(res);
      expect(m).toMatchObject({ kind: 'voice', image: false, voice: { durationMs: 3000 }, expired: false, senderId: a });
      const got = await as(B, `/api/messages/${m.id}/media`);
      expect(got.status).toBe(200);
      expect(got.headers.get('content-type')).toBe(type.split(';')[0] === 'audio/webm' ? 'audio/webm' : type);
      expect(got.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    }
    const p = await page(B, dm);
    expect(p.messages.map((m) => m.voice?.durationMs)).toEqual([3000, 3000, 3000]);
    const ledger = (await env.DB.prepare("SELECT kind, duration_ms, user_id FROM media WHERE kind = 'voice'").all()).results;
    expect(ledger).toHaveLength(3);
    expect(ledger[0]).toEqual({ kind: 'voice', duration_ms: 3000, user_id: a });
  });

  it('wrong type 415, wrong magic 400, over 1 MB 413, length missing / 0 / over 2 minutes 400; nothing stored', async () => {
    expect((await voice(A, dm, WEBM, 'audio/wav')).status).toBe(415);
    expect((await voice(A, dm, WEBM, 'image/png')).status).toBe(415);
    expect((await voice(A, dm, MP4, 'audio/webm')).status).toBe(400);
    expect((await voice(A, dm, padded(WEBM, 1024 * 1024 + 1))).status).toBe(413);
    for (const ms of ['', '0', '-5', '1.5', 'abc', String(121_001)]) expect((await voice(A, dm, WEBM, 'audio/webm', ms)).status, ms).toBe(400);
    expect(await r2Keys()).toEqual([]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{ n: number }>())!.n).toBe(0);
    expect((await voice(A, dm, padded(WEBM, 1024 * 1024), 'audio/webm', 120_000)).status).toBe(201);
  });

  it('a cross-site form cannot post one: an audio body anywhere else is 415', async () => {
    const res = await run(A, `/api/conversations/${dm}/messages`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: WEBM as BodyInit });
    expect(res.status).toBe(415);
  });

  it('a stranger, or a member of no such chat, gets 404 for upload and for the file', async () => {
    expect((await voice(D, dm)).status).toBe(404);
    expect((await photo(D, dm)).status).toBe(404);
    const m = await json<Message>(await voice(A, dm));
    expect((await as(D, `/api/messages/${m.id}/media`)).status).toBe(404);
    expect((await as(D, `/api/messages/${m.id}/image`)).status).toBe(404);
    expect((await as(B, `/api/messages/${m.id}/media`)).status).toBe(200);
  });

  it('answers byte ranges with 206 (Safari plays audio this way)', async () => {
    const m = await json<Message>(await voice(A, dm, padded(WEBM, 100)));
    const res = await run(B, `/api/messages/${m.id}/media`, { headers: { Range: 'bytes=0-1' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-1/100');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(Uint8Array.from([0x1a, 0x45]));
    const tail = await run(B, `/api/messages/${m.id}/media`, { headers: { Range: 'bytes=-10' } });
    expect(tail.status).toBe(206);
    expect(tail.headers.get('content-range')).toBe('bytes 90-99/100');
  });

  it('without storage (no MEDIA binding) uploads answer 503 not_configured', async () => {
    expect((await voice(A, dm, WEBM, 'audio/webm', 1000, { MEDIA: undefined })).status).toBe(503);
    expect((await photo(A, dm, PNG, 'image/png', { MEDIA: undefined })).status).toBe(503);
  });
});

describe('switches and the /api/app capability', () => {
  it('photos and voice are on by default; off = 403 feature_off for that upload only', async () => {
    const app1 = await json(await as(A, '/api/app'));
    expect(app1.features).toMatchObject({ photos: true, voice: true });
    expect(app1.media).toBe(true);
    expect((await json(await as(A, '/api/app', 'GET', undefined, { MEDIA: undefined }))).media).toBe(false);
    await setApp('features', { photos: false });
    expect(await json(await photo(A, dm))).toEqual({ error: 'feature_off' });
    expect((await voice(A, dm)).status).toBe(201);
    await setApp('features', { voice: false });
    expect((await voice(A, dm)).status).toBe(403);
    expect((await photo(A, dm)).status).toBe(201);
  });

  it('media settings validate: whole months 1-24, cap 10-10000 MB', async () => {
    expect((await as(A, '/api/admin/app/media', 'PUT', { value: { retentionMonths: 0 } })).status).toBe(400);
    expect((await as(A, '/api/admin/app/media', 'PUT', { value: { capMb: 5 } })).status).toBe(400);
    expect((await as(A, '/api/admin/app/media', 'PUT', { value: { retentionMonths: 2.5 } })).status).toBe(400);
    const ok = await json(await as(A, '/api/admin/app/media', 'PUT', { value: { retentionMonths: 3 } }));
    expect(ok.value).toEqual({ retentionMonths: 3, capMb: 300 });
    expect((await as(B, '/api/admin/app/media', 'PUT', { value: { retentionMonths: 3 } })).status).toBe(403);
  });
});

describe('retention: the daily scheduled run', () => {
  const at = (iso: string) => ({ scheduledTime: Date.parse(iso), cron: '17 4 * * *', noRetry: () => undefined }) as unknown as ScheduledController;

  it('removes files older than the admin months (default 6), keeps the message as "expired"', async () => {
    const old = await json<Message>(await photo(A, dm));
    const fresh = await json<Message>(await voice(B, dm));
    // Age the first one: it was "sent" 7 months ago.
    const sevenAgo = monthsBefore(new Date(), 7);
    await env.DB.batch([
      env.DB.prepare('UPDATE media SET created_at = ? WHERE message_id = ?').bind(sevenAgo, old.id),
    ]);
    const oldKey = (await keyOf(old.id))!;
    await worker.scheduled!(at(new Date().toISOString()), env as unknown as Env);
    expect(await keyOf(old.id)).toBeNull();
    expect(await keyOf(fresh.id)).not.toBeNull();
    expect(await r2Keys()).toEqual([(await keyOf(fresh.id))!]);
    expect((await env.DB.prepare('SELECT deleted_at FROM media WHERE key = ?').bind(oldKey).first<{ deleted_at: string | null }>())!.deleted_at).not.toBeNull();
    const p = await page(A, dm);
    const shown = p.messages.find((m) => m.id === old.id)!;
    expect(shown).toMatchObject({ kind: 'image', image: false, expired: true, deleted: false });
    expect((await as(B, `/api/messages/${old.id}/media`)).status).toBe(404);
    // Moving the clock 7 months on expires the other one too; the admin's months are read at run time.
    await worker.scheduled!(at(new Date(Date.now() + 7 * 31 * 86_400_000).toISOString()), env as unknown as Env);
    expect((await page(A, dm)).messages.find((m) => m.id === fresh.id)).toMatchObject({ kind: 'voice', voice: null, expired: true });
    expect(await r2Keys()).toEqual([]);
  });

  it('the admin months setting is used (1 month)', async () => {
    await setApp('media', { retentionMonths: 1 });
    const m = await json<Message>(await photo(A, dm));
    await runRetention(env, new Date(Date.now() + 20 * 86_400_000));
    expect(await keyOf(m.id)).not.toBeNull();
    await runRetention(env, new Date(Date.now() + 32 * 86_400_000));
    expect(await keyOf(m.id)).toBeNull();
  });

  it('per-person cap: the oldest files of whoever is over it go until they fit; others keep theirs', async () => {
    await setApp('media', { capMb: 10 });
    const MB = 1024 * 1024;
    // Seed the ledger directly (uploads are capped at 2 MB): A has 4 x 3 MB = 12 MB, B has 3 MB.
    const ins = (key: string, user: string, mb: number, day: number) => [
      env.MEDIA!.put(key, PNG),
      env.DB.prepare(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, image_key, created_at) VALUES (?1, ?2, ?3, 'image', '', ?4, ?5)`)
        .bind(`m-${key}`, dm, user, key, `2026-11-0${day}T00:00:00.000Z`).run(),
      env.DB.prepare('INSERT INTO media (key, conversation_id, message_id, user_id, kind, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(key, dm, `m-${key}`, user, 'photo', mb * MB, `2026-11-0${day}T00:00:00.000Z`).run(),
    ];
    for (const [k, u, d] of [['a1', a, 1], ['a2', a, 2], ['a3', a, 3], ['a4', a, 4], ['b1', b, 1]] as const) await Promise.all(ins(k, u, 3, d));
    const report = await runRetention(env, new Date('2026-11-10T00:00:00.000Z'));
    expect(report).toMatchObject({ overCap: 1, aged: 0, orphaned: 0 });
    expect(await r2Keys()).toEqual(['a2', 'a3', 'a4', 'b1']);
    expect(await keyOf('m-a1')).toBeNull();
    // Running again changes nothing (9 MB fits).
    expect((await runRetention(env, new Date('2026-11-10T00:00:00.000Z'))).overCap).toBe(0);
  });

  it('the cap is also checked at upload: the oldest files go to make room for the new one', async () => {
    await setApp('media', { capMb: 10 });
    const MB = 1024 * 1024;
    for (const [k, d] of [['x1', 1], ['x2', 2]] as const) {
      await env.MEDIA!.put(k, PNG);
      await env.DB.prepare(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, image_key, created_at) VALUES (?1, ?2, ?3, 'image', '', ?4, ?5)`)
        .bind(`m-${k}`, dm, a, k, `2026-11-0${d}T00:00:00.000Z`).run();
      await env.DB.prepare('INSERT INTO media (key, conversation_id, message_id, user_id, kind, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(k, dm, `m-${k}`, a, 'photo', 5 * MB - 10, `2026-11-0${d}T00:00:00.000Z`).run();
    }
    const res = await photo(A, dm, padded(PNG, 1000));
    expect(res.status).toBe(201);
    const m = await json<Message>(res);
    expect(await r2Keys()).toEqual(['x2', (await keyOf(m.id))!].sort());
    expect((await page(A, dm)).messages.find((x) => x.id === 'm-x1')).toMatchObject({ expired: true });
    // B is under the cap: nothing of theirs is touched, and nothing of A's either.
    expect((await photo(B, dm)).status).toBe(201);
    expect(await r2Keys()).toHaveLength(3);
  });

  it('orphans (message gone, chat gone) are swept; long-removed ledger rows are purged after 30 days', async () => {
    const m = await json<Message>(await photo(A, dm));
    const key = (await keyOf(m.id))!;
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(m.id).run(); // e.g. a cascade
    expect(await r2Keys()).toEqual([key]);
    expect((await runRetention(env)).orphaned).toBe(1);
    expect(await r2Keys()).toEqual([]);
    expect((await runRetention(env, new Date(Date.now() + 31 * 86_400_000))).purged).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{ n: number }>())!.n).toBe(0);
  });

  it('deleting a voice memo message removes its file and marks the ledger at once', async () => {
    const m = await json<Message>(await voice(A, dm));
    expect((await as(A, `/api/messages/${m.id}`, 'DELETE')).status).toBe(204);
    expect(await r2Keys()).toEqual([]);
    expect((await env.DB.prepare('SELECT deleted_at FROM media WHERE message_id = ?').bind(m.id).first<{ deleted_at: string | null }>())!.deleted_at).not.toBeNull();
    expect((await page(A, dm)).messages[0]).toMatchObject({ deleted: true, expired: false });
  });

  it('wrangler.toml schedules the daily run for dev and production', async () => {
    // (prodConfig.test.ts reads the file; here: the handler exists on the default export.)
    expect(typeof worker.scheduled).toBe('function');
  });
});

describe('admin: storage numbers and Delete account', () => {
  it('GET /api/admin/media totals live files; Delete account removes that person\'s files', async () => {
    await photo(A, dm, padded(PNG, 1000));
    await voice(B, dm, padded(WEBM, 500));
    await voice(B, dm, padded(WEBM, 300));
    const u = await json(await as(A, '/api/admin/media'));
    expect(u).toMatchObject({ bytes: 1800, files: 3, configured: true });
    expect(u.people[0]).toMatchObject({ userId: a, username: 'dan', bytes: 1000 });
    expect((await as(B, '/api/admin/media')).status).toBe(403);
    expect((await as(A, `/api/admin/users/${b}/delete`, 'POST')).status).toBe(204);
    expect(await r2Keys()).toHaveLength(1);
    expect(await json(await as(A, '/api/admin/media'))).toMatchObject({ bytes: 1000, files: 1 });
  });
});

describe('Recent emoji in chat reactions', () => {
  it('a custom emoji reaction updates /api/me recentEmoji in the same batch; the quick set does not', async () => {
    const m = await json<Message>(await as(B, `/api/conversations/${dm}/messages`, 'POST', { text: 'hi' }));
    const spy = spyD1(env.DB);
    const res = await app.fetch(new Request(`https://app.test/api/conversations/${dm}/messages/${m.id}/reaction`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emoji: '🦊' }),
    }), { ...env, DB: spy.db, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env);
    expect(await json(res)).toEqual({ reactions: [{ userId: a, emoji: '🦊' }], recentEmoji: ['🦊'] });
    expect(spy.binds.some((x) => /UPDATE users SET recent_emoji/.test(x.sql))).toBe(true);
    expect((await json(await as(A, '/api/me'))).recentEmoji).toEqual(['🦊']);
    await as(A, `/api/conversations/${dm}/messages/${m.id}/reaction`, 'PUT', { emoji: '🔥' });
    expect((await json(await as(A, '/api/me'))).recentEmoji).toEqual(['🦊']);
    for (const e of ['🐸', '🍜', '🎸', '🌙', '🐸']) await as(A, `/api/conversations/${dm}/messages/${m.id}/reaction`, 'PUT', { emoji: e });
    expect((await json(await as(A, '/api/me'))).recentEmoji).toEqual(['🐸', '🌙', '🎸', '🍜']);
  });

  it('reacting to a deleted message records nothing', async () => {
    const m = await json<Message>(await as(B, `/api/conversations/${dm}/messages`, 'POST', { text: 'hi' }));
    await as(B, `/api/messages/${m.id}`, 'DELETE');
    expect((await as(A, `/api/conversations/${dm}/messages/${m.id}/reaction`, 'PUT', { emoji: '🦊' })).status).toBe(404);
    expect((await json(await as(A, '/api/me'))).recentEmoji).toEqual([]);
  });

  it('a stored list with junk is cleaned when read', async () => {
    await env.DB.prepare('UPDATE users SET recent_emoji = ? WHERE id = ?').bind(JSON.stringify(['🦊', 'x', '❤️', '🦊', 5, '🐸']), a).run();
    expect((await json(await as(A, '/api/me'))).recentEmoji).toEqual(['🦊', '🐸']);
    await env.DB.prepare('UPDATE users SET recent_emoji = ? WHERE id = ?').bind('not json', a).run();
    expect((await json(await as(A, '/api/me'))).recentEmoji).toEqual([]);
  });
});
