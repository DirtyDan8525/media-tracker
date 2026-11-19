import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_SETTING_DEFAULTS, CATEGORY_CONFIG, FEATURE_KEYS, type FeatureKey } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';
import type { LookupInfo, SourceId } from '@media-tracker/shared';
import { BACKUP_SKIPPED_TABLES, BACKUP_TABLES } from '../src/admin/backup';
import { SOURCES, type SourceEntry } from '../src/lookup/sources/index';
import { spyD1 } from './d1spy';

// Phase 6c, AD1-AD11 (server side): app settings, feature switches, defaults, moderation, numbers, lookup tools, backup.
const ADMIN = 'dan@x.com';
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const call = (email: string | null, path: string, method = 'GET', body?: unknown, o: { db?: D1Database; over?: Partial<Env>; headers?: Record<string, string> } = {}) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...o.headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    {
      ...env,
      ...(o.db ? { DB: o.db } : {}),
      ADMIN_EMAIL: ADMIN,
      ...(email ? { ENVIRONMENT: 'dev', DEV_EMAIL: email } : { ENVIRONMENT: 'prod', DEV_EMAIL: undefined }),
      ...o.over,
    } as Env,
  );
const admin = (path: string, method = 'GET', body?: unknown, o = {}) => call(ADMIN, path, method, body, o);
const json = async <T = any>(res: Response) => (await res.json()) as T;
const put = (key: string, value: unknown) => admin(`/api/admin/app/${key}`, 'PUT', { value });
const setFeature = async (key: FeatureKey, on: boolean) => {
  expect((await put('features', { [key]: on })).status).toBe(200);
};

const ids = { dan: 'uDan', ren: 'uRen', vance: 'uVance' };
let danId: string;
beforeEach(async () => {
  danId = (await json<{ id: string }>(await admin('/api/me'))).id;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('uRen', 'ren@x.com', 'ren', '{}', ?)").bind(iso(1)),
    env.DB.prepare("INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('uVance', 'vance@x.com', 'vance', '{}', ?)").bind(iso(1)),
  ]);
});
afterEach(async () => {
  for (const k of Object.keys(SOURCES) as SourceId[]) delete SOURCES[k];
  Object.assign(SOURCES, realSources);
  await env.DB.exec(
    'DELETE FROM users; DELETE FROM app_settings; DELETE FROM login_failures; DELETE FROM lookup_cache; DELETE FROM signup_links',
  );
});
const realSources = { ...SOURCES };

describe('admin only', () => {
  it('every Phase 6c admin route is 403 for a member and 401 signed out', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/admin/app'], ['PUT', '/api/admin/app/brand'], ['DELETE', '/api/admin/app/brand'],
      ['GET', '/api/admin/comments'], ['GET', '/api/admin/numbers'], ['POST', '/api/admin/lookup/check'],
      ['POST', '/api/admin/lookup/explain'], ['GET', '/api/admin/backup'],
    ];
    for (const [method, path] of routes) {
      const res = await call('ren@x.com', path, method, method === 'GET' ? undefined : { value: {} });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await json(res)).toEqual({ error: 'forbidden' });
      expect((await call(null, path, method, method === 'GET' ? undefined : { value: {} })).status, `${method} ${path} signed out`).toBe(401);
    }
    expect((await admin('/api/admin/app/brand', 'PUT', { value: { name: 'Nope' } }, {})).status).toBe(200); // the admin passes
  });
});

describe('GET /api/app (AD1)', () => {
  it('answers signed out with the defaults, read-only, no secrets', async () => {
    const res = await call(null, '/api/app');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.features).toEqual(APP_SETTING_DEFAULTS.features);
    expect(body.brand).toEqual(APP_SETTING_DEFAULTS.brand);
    expect(body.announcement).toBeNull();
    expect(body.whatsNew).toBeNull();
    expect(body.lists.order).toEqual(Object.keys(CATEGORY_CONFIG));
    expect('defaults' in body).toBe(false);
    // Nothing but the read is open to the signed-out: a write falls through to the signed-in API.
    expect((await call(null, '/api/app', 'POST', {})).status).toBe(401);
    expect((await call(null, '/api/app', 'PUT', {})).status).toBe(401);
  });

  it('shows saved values next day, an ended announcement is hidden, and it costs 1 query', async () => {
    await put('brand', { name: 'Our Shelf', welcome: 'Hi all', accent: null });
    await put('announcement', { text: 'Maintenance Sunday', endsAt: '2000-01-01' });
    expect((await json(await call(null, '/api/app'))).announcement).toBeNull();
    await put('announcement', { text: 'Maintenance Sunday', link: 'https://x.test/' });
    const spy = spyD1(env.DB);
    const body = await json(await call(null, '/api/app', 'GET', undefined, { db: spy.db }));
    expect(spy.queries).toBe(1);
    expect(body.brand.name).toBe('Our Shelf');
    expect(body.announcement).toMatchObject({ text: 'Maintenance Sunday', link: 'https://x.test/' });
  });
});

describe('PUT /api/admin/app/:key (AD1)', () => {
  const GOOD: Record<string, unknown> = {
    features: { comments: false },
    announcement: { text: 'Hello' },
    whatsNew: [{ version: 'v1', date: '2026-11-17', items: ['One'] }],
    comingSoon: ['Later'],
    about: 'Line one\nLine two',
    brand: { name: 'Our Shelf', welcome: 'Hi', accent: '#ffd166' },
    defaults: { lists: ['anime', 'tv'], theme: 'Ocean', privateByDefault: true, notesPrivateByDefault: false },
    lists: { order: [...Object.keys(CATEGORY_CONFIG)].reverse(), hidden: ['tv'] },
  };
  const BAD: Record<string, unknown[]> = {
    features: [{ comments: 'no' }, { bogus: true }, 'off'],
    announcement: [{ text: 'x'.repeat(281) }, { text: 'x', link: 'ftp://x' }, { text: 'x', endsAt: 'tomorrow' }],
    whatsNew: [[{ version: '', date: '2026-11-17', items: [] }], 'x'],
    comingSoon: [[1], Array(31).fill('x')],
    about: ['x'.repeat(2001), 5],
    brand: [{ name: '' }, { name: 'x'.repeat(41) }, { name: 'x', welcome: 'w'.repeat(201) }, { name: 'x', accent: '#010203' }],
    defaults: [{ lists: [] }, { lists: ['nope'] }, { theme: 'Neon' }, { privateByDefault: 1 }],
    lists: [{ order: ['anime'], hidden: [] }, { order: Object.keys(CATEGORY_CONFIG), hidden: Object.keys(CATEGORY_CONFIG) }],
  };

  it.each(Object.keys(GOOD))('%s: valid value saved and read back, bad values 400 and nothing saved', async (key) => {
    for (const bad of BAD[key]!) {
      expect((await put(key, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM app_settings').first<{ n: number }>())!.n).toBe(0);
    const res = await put(key, GOOD[key]);
    expect(res.status).toBe(200);
    const saved = await json(res);
    expect(saved.key).toBe(key);
    const all = await json(await admin('/api/admin/app'));
    expect(all.set).toEqual([key]);
    expect(all.settings[key]).toEqual(saved.value);
  });

  it('unknown key 404, missing or non-object body 400', async () => {
    expect((await put('nope', {})).status).toBe(404);
    expect((await admin('/api/admin/app/brand', 'PUT', {})).status).toBe(400);
    expect((await admin('/api/admin/app/brand', 'PUT', '[]')).status).toBe(400);
    expect((await admin('/api/admin/app/nope', 'DELETE')).status).toBe(404);
  });

  it('a saved announcement gets a new id each time; DELETE brings the default back; stored junk falls back', async () => {
    const a = (await json(await put('announcement', { text: 'Hi' }))).value;
    const b = (await json(await put('announcement', { text: 'Hi' }))).value;
    expect(a.id).not.toBe(b.id);
    expect(b.id).not.toBe('');
    await put('brand', { name: 'Ours' });
    expect((await admin('/api/admin/app/brand', 'DELETE')).status).toBe(204);
    expect((await json(await call(null, '/api/app'))).brand).toEqual(APP_SETTING_DEFAULTS.brand);
    await env.DB.prepare("INSERT INTO app_settings VALUES ('brand', '{\"name\":\"\"}', ?)").bind(iso(0)).run();
    expect((await json(await call(null, '/api/app'))).brand).toEqual(APP_SETTING_DEFAULTS.brand);
  });
});

// ---- feature switches (AD2) ----
describe('feature switches', () => {
  const seedPost = () => env.DB.batch([
    env.DB.prepare("INSERT INTO entries (id, user_id, category, title, rating, created_at, updated_at) VALUES ('e1', 'uRen', 'anime', 'Frieren', 9, ?1, ?1)").bind(iso(1)),
    env.DB.prepare("INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES ('p1', 'uRen', 'e1', 'rated', '{}', ?1, ?1)").bind(iso(1)),
  ]);

  it('all nine are on by default and listed in GET /api/app', async () => {
    const f = (await json(await call(null, '/api/app'))).features;
    expect(Object.keys(f)).toEqual([...FEATURE_KEYS]);
    expect(Object.values(f)).toEqual(FEATURE_KEYS.map(() => true));
  });

  it('comments off: POST /api/comments is 403 feature_off, reading and deleting still work; back on works', async () => {
    await seedPost();
    expect((await call('vance@x.com', '/api/comments', 'POST', { activityId: 'p1', body: 'nice' })).status).toBe(201);
    await setFeature('comments', false);
    const res = await call('vance@x.com', '/api/comments', 'POST', { activityId: 'p1', body: 'again' });
    expect([res.status, await json(res)]).toEqual([403, { error: 'feature_off' }]);
    expect((await json<unknown[]>(await call('vance@x.com', '/api/comments?activityId=p1'))).length).toBe(1);
    await setFeature('comments', true);
    expect((await call('vance@x.com', '/api/comments', 'POST', { activityId: 'p1', body: 'again' })).status).toBe(201);
  });

  it('reactions off: toggling is 403 feature_off, reading is fine', async () => {
    await seedPost();
    await setFeature('reactions', false);
    const res = await call('vance@x.com', '/api/reactions', 'POST', { activityId: 'p1', emoji: '👍' });
    expect([res.status, await json(res)]).toEqual([403, { error: 'feature_off' }]);
    expect((await call('vance@x.com', '/api/reactions?activityId=p1')).status).toBe(200);
    await setFeature('reactions', true);
    expect((await call('vance@x.com', '/api/reactions', 'POST', { activityId: 'p1', emoji: '👍' })).status).toBe(200);
  });

  it('friends off: requests, accepting and invite links are 403; the list still reads', async () => {
    await env.DB.prepare("UPDATE users SET invite_code = 'ABCD2345' WHERE id = 'uRen'").run();
    await env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES ('uRen', 'uVance', 'pending', 'uRen', ?)").bind(iso(1)).run();
    await setFeature('friends', false);
    for (const [who, path, body] of [
      ['vance@x.com', '/api/friends/requests', { username: 'ren' }],
      ['vance@x.com', '/api/friends/uRen/accept', {}],
      ['vance@x.com', '/api/friends/add/ABCD2345', {}],
    ] as const) {
      const res = await call(who, path, 'POST', body);
      expect([path, res.status, await json(res)]).toEqual([path, 403, { error: 'feature_off' }]);
    }
    expect((await call('vance@x.com', '/api/friends')).status).toBe(200);
    expect((await env.DB.prepare("SELECT status FROM friendships").first<{ status: string }>())!.status).toBe('pending');
    await setFeature('friends', true);
    expect((await call('vance@x.com', '/api/friends/uRen/accept', 'POST', {})).status).toBe(204);
  });

  it('messages off: creating a chat, sending text and sending a picture are 403; reading is fine', async () => {
    await env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at, accepted_at) VALUES ('uRen', 'uVance', 'accepted', 'uRen', ?1, ?1)").bind(iso(1)).run();
    const made = await call('vance@x.com', '/api/conversations', 'POST', { userIds: ['uRen'] });
    expect(made.status).toBe(201);
    const conv = (await json<{ id: string }>(made)).id;
    await setFeature('messages', false);
    for (const res of [
      await call('vance@x.com', '/api/conversations', 'POST', { userIds: ['uDan'] }),
      await call('vance@x.com', `/api/conversations/${conv}/messages`, 'POST', { text: 'hi' }),
      await call('vance@x.com', `/api/conversations/${conv}/messages/image`, 'POST', new Uint8Array(20), { headers: { 'content-type': 'image/png' } }),
    ]) {
      expect([res.status, await json(res)]).toEqual([403, { error: 'feature_off' }]);
    }
    expect((await call('vance@x.com', `/api/conversations/${conv}/messages`)).status).toBe(200);
    await setFeature('messages', true);
    expect((await call('vance@x.com', `/api/conversations/${conv}/messages`, 'POST', { text: 'hi' })).status).toBe(201);
  });

  it('signups off: a plain sign-up is 403 feature_off and writes nothing; a live sign-up link still works', async () => {
    await setFeature('signups', false);
    const signup = (extra: object = {}, name = 'newbie') => call(null, '/api/auth/signup', 'POST', { username: name, password: 'correct horse', ...extra });
    const res = await signup();
    expect([res.status, await json(res)]).toEqual([403, { error: 'feature_off' }]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'newbie'").first<{ n: number }>())!.n).toBe(0);

    // Not a live link: refused too, and still nothing written (no pending account, no orphan session).
    const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())!.n;
    expect((await signup({ joinToken: 'a'.repeat(43) })).status).toBe(403);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE username = ?').bind('newbie').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())!.n).toBe(before);

    const link = (await json<{ link: string }>(await admin('/api/admin/signup-links', 'POST'))).link;
    const joined = await signup({ joinToken: link.split('/').pop() }, 'linked');
    expect(joined.status).toBe(201);
    expect((await json(joined)).status).toBe('active');
    // The link is single use: a second person with it is refused while sign-ups are closed.
    expect((await signup({ joinToken: link.split('/').pop() }, 'second')).status).toBe(403);
    await setFeature('signups', true);
    expect((await signup()).status).toBe(201);
  });
});

// ---- defaults for new people (AD6) ----
describe('defaults at sign-up and for new titles', () => {
  it('a new account starts with the default lists on, the rest off, and the default theme', async () => {
    await put('defaults', { lists: ['anime', 'tv'], theme: 'Ocean' });
    const res = await call(null, '/api/auth/signup', 'POST', { username: 'newbie', password: 'correct horse' });
    expect(res.status).toBe(201);
    const me = await json(res);
    expect(me.settings.theme).toBe('Ocean');
    expect(me.settings.tabs).toMatchObject({ anime: true, tv: true, movies: false, games: false, youtube: false, animeSeasons: true });
  });

  it('with nothing set, a new account gets the old defaults', async () => {
    const me = await json(await call(null, '/api/auth/signup', 'POST', { username: 'plain', password: 'correct horse' }));
    expect(me.settings.theme).toBe('Midnight');
    expect(Object.values(me.settings.tabs).every(Boolean)).toBe(true);
  });

  it('new titles start private (and notes private) only when the person did not choose', async () => {
    const add = async (title: string, extra: object = {}) =>
      (await json(await call('ren@x.com', '/api/entries', 'POST', { category: 'anime', title, ...extra }))).entry;
    expect(await add('Plain')).toMatchObject({ isPrivate: false, notesPrivate: false });
    await put('defaults', { privateByDefault: true, notesPrivateByDefault: true });
    expect(await add('Defaulted')).toMatchObject({ isPrivate: true, notesPrivate: true });
    expect(await add('Chosen', { isPrivate: false, notesPrivate: false })).toMatchObject({ isPrivate: false, notesPrivate: false });
    await put('defaults', { privateByDefault: true, notesPrivateByDefault: false });
    expect(await add('Half')).toMatchObject({ isPrivate: true, notesPrivate: false });
  });
});

// ---- moderation (AD7) ----
describe('moderation', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO entries (id, user_id, category, title, is_private, rating, created_at, updated_at) VALUES ('e1', 'uRen', 'anime', 'Secret Show', 1, 9, ?1, ?1)").bind(iso(2)),
      env.DB.prepare("INSERT INTO entries (id, user_id, category, title, is_private, rating, created_at, updated_at) VALUES ('e2', 'uRen', 'anime', 'Open Show', 0, 7, ?1, ?1)").bind(iso(2)),
      env.DB.prepare("INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES ('p1', 'uRen', 'e1', 'rated', '{}', ?1, ?1)").bind(iso(2)),
      env.DB.prepare("INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES ('p2', 'uRen', 'e2', 'rated', '{}', ?1, ?1)").bind(iso(2)),
      env.DB.prepare("INSERT INTO comments (id, activity_id, user_id, body, created_at) VALUES ('c1', 'p1', 'uVance', 'rude one', ?)").bind(iso(1)),
      env.DB.prepare("INSERT INTO comments (id, activity_id, user_id, body, created_at) VALUES ('c2', 'p2', 'uVance', 'newer', ?)").bind(iso(0)),
      env.DB.prepare("INSERT INTO comments (id, entry_id, user_id, body, created_at) VALUES ('c3', 'e2', 'uVance', 'on entry', ?)").bind(iso(3)),
      env.DB.prepare("INSERT INTO comments (id, entry_id, user_id, body, created_at, deleted_at) VALUES ('c4', 'e2', 'uVance', 'gone', ?1, ?1)").bind(iso(1)),
    ]);
  });

  it('the admin deletes any comment, even on a private post; a stranger cannot; 404 when already gone', async () => {
    expect((await call('vance@x.com', '/api/comments/c2', 'DELETE')).status).toBe(204); // the author can (a public post)
    await env.DB.exec("INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('uSt', 'st@x.com', 'st', '{}', '2026-01-01T00:00:00.000Z')");
    expect((await call('st@x.com', '/api/comments/c1', 'DELETE')).status).toBe(404);
    expect((await admin('/api/comments/c1', 'DELETE')).status).toBe(204);
    expect((await env.DB.prepare("SELECT deleted_at FROM comments WHERE id = 'c1'").first<{ deleted_at: string | null }>())!.deleted_at).not.toBeNull();
    expect((await admin('/api/comments/c1', 'DELETE')).status).toBe(404);
    expect((await admin('/api/comments/c3', 'DELETE')).status).toBe(204); // an entry comment too
  });

  it('the admin deletes any post with its reactions and comments; a member cannot delete another person\'s', async () => {
    await env.DB.prepare("INSERT INTO reactions (id, activity_id, user_id, emoji, created_at) VALUES ('r1', 'p1', 'uVance', '👍', ?)").bind(iso(1)).run();
    expect((await call('vance@x.com', '/api/activity/p1', 'DELETE')).status).toBe(404);
    expect((await admin('/api/activity/p1', 'DELETE')).status).toBe(204);
    const left = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE activity_id = 'p1'`).first<{ n: number }>())!.n;
    expect(await left('reactions')).toBe(0);
    expect(await left('comments')).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE id = 'p1'").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE id = 'e1'").first<{ n: number }>())!.n).toBe(1); // the title stays
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE id = 'p2'").first<{ n: number }>())!.n).toBe(1);
    expect((await admin('/api/activity/nope', 'DELETE')).status).toBe(404);
  });

  it('the admin deletes any message, in a chat they are not in, and its picture goes from storage', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO conversations (id, kind, created_by, created_at, last_message_at, direct_key) VALUES ('cv', 'direct', 'uRen', ?1, ?1, 'uRen:uVance')").bind(iso(1)),
      env.DB.prepare("INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('cv', 'uRen', ?1), ('cv', 'uVance', ?1)").bind(iso(1)),
      env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, kind, body, image_key, created_at) VALUES ('m1', 'cv', 'uRen', 'image', '', 'msg/cv/m1', ?)").bind(iso(1)),
      env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at) VALUES ('m2', 'cv', 'uRen', 'text', 'private words', ?)").bind(iso(1)),
    ]);
    await env.MEDIA!.put('msg/cv/m1', new Uint8Array([1, 2, 3]));
    await env.DB.exec("INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('uSt', 'st@x.com', 'st', '{}', '2026-01-01T00:00:00.000Z')");
    expect((await call('st@x.com', '/api/messages/m2', 'DELETE')).status).toBe(404); // not in the chat
    expect((await admin('/api/messages/m1', 'DELETE')).status).toBe(204);
    expect(await env.MEDIA!.get('msg/cv/m1')).toBeNull();
    expect((await admin('/api/messages/m2', 'DELETE')).status).toBe(204);
    const rows = (await env.DB.prepare('SELECT id, body, image_key, deleted_at FROM messages ORDER BY id').all<any>()).results;
    expect(rows.map((r) => [r.id, r.body, r.image_key, r.deleted_at !== null])).toEqual([['m1', '', null, true], ['m2', '', null, true]]);
    expect((await admin('/api/messages/nope', 'DELETE')).status).toBe(404);
    // A member who is not the sender still cannot.
    await env.DB.exec("UPDATE messages SET deleted_at = NULL, body = 'x' WHERE id = 'm2'");
    expect((await call('vance@x.com', '/api/messages/m2', 'DELETE')).status).toBe(403);
  });

  it('GET /api/admin/comments: newest first with author and title, deleted left out, limit clamped, 1 query', async () => {
    const spy = spyD1(env.DB);
    const res = await admin('/api/admin/comments', 'GET', undefined, { db: spy.db });
    expect(spy.queries).toBe(1 + 1); // + the admin's own sign-in lookup
    const { comments } = await json<{ comments: any[] }>(res);
    expect(comments.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
    expect(comments[1]).toMatchObject({
      body: 'rude one', activityId: 'p1', entryId: 'e1', title: 'Secret Show', category: 'anime', owner: 'ren',
      author: { id: 'uVance', username: 'vance' },
    });
    expect(comments[2]).toMatchObject({ activityId: null, entryId: 'e2', title: 'Open Show' });
    expect((await json<{ comments: unknown[] }>(await admin('/api/admin/comments?limit=1'))).comments).toHaveLength(1);
    expect((await json<{ comments: unknown[] }>(await admin('/api/admin/comments?limit=0'))).comments).toHaveLength(1);
    expect((await json<{ comments: unknown[] }>(await admin('/api/admin/comments?limit=zzz'))).comments).toHaveLength(3);
  });
});

// ---- numbers (AD9) ----
describe('GET /api/admin/numbers', () => {
  it('counts members, active people, titles and messages from the last 7 days, and ranks non-private titles', async () => {
    await env.DB.exec("UPDATE users SET status = 'pending' WHERE id = 'uVance'");
    const sess = (hash: string, user: string, daysAgo: number) =>
      env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?3)').bind(hash, user, iso(daysAgo), iso(-30));
    const ent = (id: string, user: string, title: string, rating: number | null, priv: number, daysAgo: number, cat = 'anime') =>
      env.DB.prepare('INSERT INTO entries (id, user_id, category, title, rating, is_private, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)')
        .bind(id, user, cat, title, rating, priv, iso(daysAgo));
    await env.DB.batch([
      sess('s1', 'uRen', 1), sess('s2', 'uRen', 2), sess('s3', danId, 20), sess('s4', 'uVance', 1),
      ent('a', 'uRen', 'Frieren', 9, 0, 1),
      ent('b', danId, ' frieren ', 8, 0, 10), // same title, different case and spaces
      ent('c', danId, 'Frieren', 2, 1, 1), // private: not counted
      ent('d', 'uRen', 'Frieren', null, 0, 1, 'tv'), // not rated, and another list
      ent('e', 'uRen', 'Solo', 7, 0, 30),
      ent('f', danId, 'Frieren', 6, 0, 1, 'tv'), // same title in another list counts separately
      ent('g', 'uVance', 'Pending Fan', 10, 0, 1), // pending person: not counted
      env.DB.prepare("INSERT INTO conversations (id, kind, created_by, created_at, last_message_at) VALUES ('cv', 'group', 'uRen', ?1, ?1)").bind(iso(1)),
      env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at) VALUES ('m1', 'cv', 'uRen', 'text', 'a', ?), ('m2', 'cv', 'uRen', 'text', 'b', ?), ('m3', 'cv', 'uRen', 'text', 'old', ?)")
        .bind(iso(1), iso(6), iso(8)),
    ]);
    const spy = spyD1(env.DB);
    const body = await json(await admin('/api/admin/numbers', 'GET', undefined, { db: spy.db }));
    expect(spy.queries).toBeLessThanOrEqual(1 + 5);
    expect(body).toMatchObject({ members: 2, active7: 1, titles7: 4, messages7: 2 });
    expect(body.mostRated).toEqual([
      { title: 'Frieren', category: 'anime', count: 2, average: 8.5 },
      { title: 'Solo', category: 'anime', count: 1, average: 7 }, // ties on count: higher average first
      { title: 'Frieren', category: 'tv', count: 1, average: 6 },
    ]);
  });

  it('keeps only the top 10', async () => {
    const stmts = Array.from({ length: 12 }, (_, i) =>
      env.DB.prepare("INSERT INTO entries (id, user_id, category, title, rating, created_at, updated_at) VALUES (?1, 'uRen', 'movies', ?2, ?3, ?4, ?4)")
        .bind(`t${i}`, `Title ${String(i).padStart(2, '0')}`, 5 + (i % 5), iso(1)));
    await env.DB.batch(stmts);
    expect((await json(await admin('/api/admin/numbers'))).mostRated).toHaveLength(10);
  });

  it('an empty database gives zeros and an empty list', async () => {
    expect(await json(await admin('/api/admin/numbers'))).toMatchObject({ members: 3, active7: 0, titles7: 0, messages7: 0, mostRated: [] });
  });
});

// ---- backup (AD10) ----
describe('GET /api/admin/backup', () => {
  const seedSecrets = () => env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = 'PWHASH-SECRET', public_token_hash = 'PUBLIC-HASH-SECRET' WHERE id = 'uRen'"),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES ('SESSION-HASH-SECRET', 'uRen', ?1, ?1, ?1)").bind(iso(0)),
    env.DB.prepare("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES ('RESET-HASH-SECRET', 'uRen', ?1, ?1)").bind(iso(0)),
    env.DB.prepare("INSERT INTO signup_links (token_hash, id, created_by, created_at, expires_at) VALUES ('LINK-HASH-SECRET', 'link-1', 'uRen', ?1, ?1)").bind(iso(0)),
    env.DB.prepare("INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES ('https://push.test/ENDPOINT-SECRET', 'uRen', 'P256DH-SECRET', 'AUTH-SECRET', ?)").bind(iso(0)),
    env.DB.prepare("INSERT INTO avatars (user_id, mime, data, updated_at) VALUES ('uRen', 'image/png', x'89504e47', ?)").bind(iso(0)),
    env.DB.prepare("INSERT INTO entries (id, user_id, category, title, created_at, updated_at) VALUES ('e1', 'uRen', 'anime', 'Kept Title', ?1, ?1)").bind(iso(0)),
  ]);

  it('is a JSON attachment with every included table, and none of the excluded secrets anywhere in it', async () => {
    await seedSecrets();
    await put('brand', { name: 'Kept Brand' });
    const res = await admin('/api/admin/backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="media-tracker-backup-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    for (const secret of ['PWHASH-SECRET', 'PUBLIC-HASH-SECRET', 'SESSION-HASH-SECRET', 'RESET-HASH-SECRET', 'LINK-HASH-SECRET', 'ENDPOINT-SECRET', 'P256DH-SECRET', 'AUTH-SECRET']) {
      expect(text, secret).not.toContain(secret);
    }
    const body = JSON.parse(text);
    expect(Object.keys(body.tables).sort()).toEqual(Object.keys(BACKUP_TABLES).sort());
    expect(body.tables.sessions).toBeUndefined();
    expect(body.tables.password_resets).toBeUndefined();
    const ren = body.tables.users.find((u: any) => u.id === 'uRen');
    expect(ren.username).toBe('ren');
    expect('password_hash' in ren).toBe(false);
    expect(body.tables.signup_links[0]).toMatchObject({ id: 'link-1' });
    expect('token_hash' in body.tables.signup_links[0]).toBe(false);
    expect(body.tables.push_subscriptions[0]).toMatchObject({ user_id: 'uRen' });
    for (const col of ['endpoint', 'p256dh', 'auth']) expect(col in body.tables.push_subscriptions[0]).toBe(false);
    expect(body.tables.avatars[0]).toMatchObject({ user_id: 'uRen', mime: 'image/png' });
    expect('data' in body.tables.avatars[0]).toBe(false);
    expect(body.tables.entries.map((e: any) => e.title)).toContain('Kept Title');
    expect(body.tables.app_settings[0].key).toBe('brand');
    expect(body.excluded.tables).toEqual([...BACKUP_SKIPPED_TABLES]);
    expect(body.excluded.columns).toEqual({
      users: ['password_hash', 'public_token_hash'], avatars: ['data'], signup_links: ['token_hash'], push_subscriptions: ['endpoint', 'p256dh', 'auth'],
    });
  });

  it('every table in the database is either backed up or deliberately skipped (a new table must be decided)', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    ).all<{ name: string }>();
    const known = new Set([...Object.keys(BACKUP_TABLES), ...BACKUP_SKIPPED_TABLES]);
    expect(results.map((r) => r.name).filter((n) => !known.has(n))).toEqual([]);
    expect([...known].filter((n) => !results.some((r) => r.name === n))).toEqual([]);
    // Each excluded column really exists, so a rename cannot silently start leaking it.
    for (const [table, cols] of Object.entries(BACKUP_TABLES)) {
      const info = (await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((r) => r.name);
      for (const c of cols) expect(info, `${table}.${c}`).toContain(c);
    }
  });

  it('stays inside the 50-query limit (one statement per table)', async () => {
    const spy = spyD1(env.DB);
    expect((await admin('/api/admin/backup', 'GET', undefined, { db: spy.db })).status).toBe(200);
    expect(spy.queries).toBe(Object.keys(BACKUP_TABLES).length + 1);
    expect(spy.queries).toBeLessThanOrEqual(50);
  });
});

// ---- lookup tools (AD8) ----
describe('lookup tools', () => {
  const info = (title: string): LookupInfo => ({ title, trusted: true, cover: '', genres: '', creator: '', source: 'kitsu', sourceId: '1' }) as LookupInfo;
  const register = (entries: Partial<Record<SourceId, SourceEntry>>) => {
    for (const k of Object.keys(SOURCES) as SourceId[]) delete SOURCES[k];
    Object.assign(SOURCES, entries);
  };

  it('check: one row per fixed query with ok / ms / error; an unconfigured source is ok:null "not set up"; no network', async () => {
    register({
      anilist: { search: async () => info('Cowboy Bebop') },
      kitsu: { search: async (q) => { if (q.category === 'manga') throw new Error('HTTP 503 from kitsu.io?api_key=SEKRET'); return null; } },
      tmdb: { search: async () => info('x') }, // no TMDB_KEY in the test env: skipped
      tvmaze: { search: () => new Promise(() => undefined) }, // never answers
    });
    const res = await admin('/api/admin/lookup/check', 'POST', {}, { over: { TMDB_KEY: undefined } });
    expect(res.status).toBe(200);
    const { sources } = await json<{ sources: any[] }>(res);
    const row = (label: string) => sources.find((s) => s.label === label)!;
    expect(row('AniList (anime)')).toMatchObject({ source: 'anilist', ok: true, query: 'Cowboy Bebop' });
    expect(typeof row('AniList (anime)').ms).toBe('number');
    expect(row('Kitsu (anime)')).toMatchObject({ ok: false, error: 'answered, but found nothing' });
    expect(row('Kitsu (manga)')).toMatchObject({ ok: false });
    expect(row('Kitsu (manga)').error).toContain('503');
    expect(row('TMDB (movies)')).toMatchObject({ ok: null, error: 'not set up', ms: 0 });
    expect(row('Deezer (albums)')).toMatchObject({ ok: null, error: 'not set up' }); // not registered here
    expect(sources.map((s) => s.source)).toEqual(expect.arrayContaining(['anilist', 'kitsu', 'tmdb', 'tvmaze', 'wiki', 'deezer', 'itunes', 'igdb', 'steam', 'openlibrary', 'youtube']));
  }, 30_000);

  it('check: a source that never answers is reported failing after the timeout, and secrets never show in an error', async () => {
    const { checkSources, SOURCE_CHECKS } = await import('../src/lookup/adminTools');
    register({
      tvmaze: { search: () => new Promise(() => undefined) },
      kitsu: { search: async () => { throw new Error('boom key=TOPSECRET'); } },
    });
    const rows = await checkSources({ fetch, env: { ...env, TMDB_KEY: 'TOPSECRET' } as Env }, 50);
    expect(rows).toHaveLength(SOURCE_CHECKS.length);
    expect(rows.find((r) => r.source === 'tvmaze')).toMatchObject({ ok: false, error: 'no answer after 50 ms' });
    const kitsu = rows.find((r) => r.label === 'Kitsu (anime)')!;
    expect(kitsu.ok).toBe(false);
    expect(kitsu.error).toBe('boom key=REDACTED');
  });

  it('explain: every step the chain tried, stopping at the first match, no cache written, 1 query', async () => {
    register({
      anilist: { search: async () => null },
      kitsu: { search: async (q) => info(`Found ${q.term}`) },
    });
    const spy = spyD1(env.DB);
    const res = await admin('/api/admin/lookup/explain', 'POST', { category: 'anime', title: ' Frieren ' }, { db: spy.db });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      category: 'anime', title: 'Frieren', found: 'Found Frieren', cached: null,
      steps: [
        { source: 'anilist', query: 'Frieren', results: 0, reason: 'no match' },
        { source: 'kitsu', query: 'Frieren', results: 1, chosen: 'Found Frieren' },
      ],
    });
    expect(spy.queries).toBe(1 + 1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM lookup_cache').first<{ n: number }>())!.n).toBe(0);
  });

  it('explain: a missing key, a failing source and a timeout each give a reason; nothing found gives found: null', async () => {
    register({
      igdb: { search: async () => info('never') }, // IGDB keys are not set in the test env
      steam: { search: async () => { throw new Error('HTTP 429'); } },
      wiki: { search: async () => null },
    });
    const body = await json(await admin('/api/admin/lookup/explain', 'POST', { category: 'games', title: 'Portal' }, { over: { IGDB_ID: undefined, IGDB_SECRET: undefined } }));
    expect(body.found).toBeNull();
    expect(body.steps).toEqual([
      { source: 'igdb', query: 'Portal', results: 0, reason: 'not set up (no key)' },
      { source: 'steam', query: 'Portal', results: 0, reason: 'failed: HTTP 429' },
      { source: 'wiki', query: 'Portal', results: 0, reason: 'no match' },
    ]);
  });

  it('explain: says when a normal lookup would answer from the cache instead', async () => {
    register({ anilist: { search: async () => null }, kitsu: { search: async () => null } });
    const { chainCacheKey } = await import('../src/lookup/chain');
    await env.DB.prepare("INSERT INTO lookup_cache (source, query_key, result_json, fetched_at) VALUES ('chain:anime', ?, ?, ?)")
      .bind(chainCacheKey({ term: 'Frieren', typedTitle: 'Frieren', hint: '' }), JSON.stringify(info('Old Cached Title')), iso(1)).run();
    const body = await json(await admin('/api/admin/lookup/explain', 'POST', { category: 'anime', title: 'Frieren' }));
    expect(body.cached).toBe('Old Cached Title');
    expect(body.found).toBeNull();
  });

  it('explain: validates category and title', async () => {
    for (const bad of [{}, { category: 'podcasts', title: 'x' }, { category: 'anime', title: '  ' }, { category: 'anime', title: 'x'.repeat(501) }, { category: 'anime' }]) {
      expect((await admin('/api/admin/lookup/explain', 'POST', bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('the normal lookup route behaves the same with no trace collector (and its log still works)', async () => {
    register({ anilist: { search: async () => null }, kitsu: { search: async () => info('Plain') } });
    const res = await admin('/api/lookup', 'POST', { category: 'anime', term: 'plain', debug: true });
    const body = await json(res);
    expect(body.info.title).toBe('Plain');
    expect(body.log.join('\n')).toContain('kitsu: found "Plain"');
    expect('steps' in body).toBe(false);
  });
});
