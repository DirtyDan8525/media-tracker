import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { spyD1 } from './d1spy';

// Admin Defaults for every per-person setting (Dan, 2026-11-19): follow the default unless changed; "Apply to everyone".
const ADMIN = 'dan@x.com';
const call = (email: string | null, path: string, method = 'GET', body?: unknown, db?: D1Database) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ...(db ? { DB: db } : {}), ADMIN_EMAIL: ADMIN, ...(email ? { ENVIRONMENT: 'dev', DEV_EMAIL: email } : { ENVIRONMENT: 'prod', DEV_EMAIL: undefined }) } as Env,
  );
const json = async <T = any>(r: Response) => (await r.json()) as T;
const setDefaults = async (v: object) => expect((await call(ADMIN, '/api/admin/app/defaults', 'PUT', { value: v })).status).toBe(200);
const meOf = async (email: string) => json(await call(email, '/api/me'));
const saved = async (id: string) => JSON.parse((await env.DB.prepare('SELECT settings_json FROM users WHERE id = ?').bind(id).first<{ settings_json: string }>())!.settings_json);

beforeEach(async () => {
  await call(ADMIN, '/api/me'); // creates the admin
  await env.DB.batch([
    // Ren: an account from before tracking that chose Sakura. Vance: legacy and untouched. Kim: tracked, nothing changed. Gone: removed.
    env.DB.prepare(`INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('uRen', 'ren@x.com', 'ren', '{"theme":"Sakura"}', '2026-01-01')`),
    env.DB.prepare(`INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('uVance', 'vance@x.com', 'vance', '{}', '2026-01-01')`),
    env.DB.prepare(`INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('uKim', 'kim@x.com', 'kim', '{"customized":{}}', '2026-01-01')`),
    env.DB.prepare(`INSERT INTO users (id, email, username, settings_json, status, created_at) VALUES ('uGone', 'gone@x.com', 'gone', '{}', 'removed', '2026-01-01')`),
  ]);
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users; DELETE FROM app_settings; DELETE FROM login_failures');
});

describe('effective settings', () => {
  it('follow the admin default for anything never changed, and a stored own value wins', async () => {
    await setDefaults({ theme: 'Ocean', lists: ['anime', 'tv'], compareAsk: 'Off', navSide: 'right', coverViewer: false });
    const kim = await meOf('kim@x.com');
    expect(kim.settings).toMatchObject({ theme: 'Ocean', compareAsk: 'Off', coverViewer: false, nav: { side: 'right', collapsed: false } });
    expect(kim.settings.tabs).toMatchObject({ anime: true, tv: true, movies: false, animeSeasons: true });
    expect((await meOf('vance@x.com')).settings.theme).toBe('Ocean'); // legacy, equal to built-in: not "changed"
    expect((await meOf('ren@x.com')).settings.theme).toBe('Sakura'); // legacy value that differs from built-in: their own
  });

  it("a person's own change wins and is remembered; the rest keep following", async () => {
    await setDefaults({ theme: 'Ocean', compareAsk: 'Off' });
    const put = await call('kim@x.com', '/api/me/settings', 'PUT', { settings: { theme: 'Midnight', tabs: { games: false } } });
    expect(put.status).toBe(200);
    const body = await json(put);
    expect(body.settings).toMatchObject({ theme: 'Midnight', compareAsk: 'Off' });
    expect(body.customized).toEqual({ theme: true, tabs: { games: true } });
    await setDefaults({ theme: 'Sakura', compareAsk: 'Both', lists: ['games'] });
    const me = await meOf('kim@x.com');
    expect(me.settings).toMatchObject({ theme: 'Midnight', compareAsk: 'Both' });
    expect(me.settings.tabs).toMatchObject({ games: false, anime: false });
    expect((await saved('uKim')).customized).toEqual({ theme: true, tabs: { games: true } });
  });

  it('a first save by a legacy account keeps its earlier changes as its own', async () => {
    await setDefaults({ theme: 'Ocean', compareAsk: 'Off' });
    await call('ren@x.com', '/api/me/settings', 'PUT', { settings: { searchScope: 'current' } });
    const me = await meOf('ren@x.com');
    expect(me.customized).toEqual({ theme: true, searchScope: true });
    expect(me.settings).toMatchObject({ theme: 'Sakura', searchScope: 'current', compareAsk: 'Off' });
  });

  it('a new sign-up copies nothing: it follows the defaults, even ones set later', async () => {
    await setDefaults({ theme: 'Ocean' });
    const res = await call(null, '/api/auth/signup', 'POST', { username: 'newbie', password: 'correct horse' });
    expect((await json(res)).settings.theme).toBe('Ocean');
    const id = (await env.DB.prepare("SELECT id FROM users WHERE username = 'newbie'").first<{ id: string }>())!.id;
    expect(await saved(id)).toEqual({ customized: {} });
    await setDefaults({ theme: 'Sakura' });
    expect((await json(await call(null, '/api/auth/login', 'POST', { username: 'newbie', password: 'correct horse' }))).settings.theme).toBe('Sakura');
  });

  it('adds no query to /api/me', async () => {
    await call('kim@x.com', '/api/me');
    const spy = spyD1(env.DB);
    await call('kim@x.com', '/api/me', 'GET', undefined, spy.db);
    expect(spy.queries).toBeLessThanOrEqual(3);
    expect(spy.binds.filter((b) => /FROM app_settings/.test(b.sql) && !/AS app_defaults/.test(b.sql))).toHaveLength(0); // the defaults ride in the sign-in query
  });
});

describe('POST /api/admin/defaults/apply', () => {
  it('is admin only and refuses an unknown key', async () => {
    expect((await call('ren@x.com', '/api/admin/defaults/apply', 'POST', { key: 'theme' })).status).toBe(403);
    expect((await call(null, '/api/admin/defaults/apply', 'POST', { key: 'theme' })).status).toBe(401);
    expect((await call(ADMIN, '/api/admin/defaults/apply', 'POST', { key: 'tiers' })).status).toBe(400);
    expect((await call(ADMIN, '/api/admin/defaults/apply', 'POST', {})).status).toBe(400);
  });

  it('overrides people who changed the setting, forgets that they did, leaves their other changes and removed people alone', async () => {
    await call('kim@x.com', '/api/me/settings', 'PUT', { settings: { theme: 'Sakura', compareAsk: 'Off', tabs: { games: false } } });
    await setDefaults({ theme: 'Ocean', compareAsk: 'Both' });
    const res = await call(ADMIN, '/api/admin/defaults/apply', 'POST', { key: 'theme' });
    expect(await json(res)).toEqual({ key: 'theme', people: 4 }); // admin, ren, vance, kim; not the removed one
    const kim = await meOf('kim@x.com');
    expect(kim.settings).toMatchObject({ theme: 'Ocean', compareAsk: 'Off' });
    expect(kim.customized).toEqual({ compareAsk: true, tabs: { games: true } });
    const ren = await meOf('ren@x.com'); // legacy: changed theme, now follows it again
    expect(ren.settings.theme).toBe('Ocean');
    expect(ren.customized).toEqual({});
    expect((await saved('uGone')).theme).toBeUndefined();
    // Later changes to the default reach them again.
    await setDefaults({ theme: 'Sakura' });
    expect((await meOf('ren@x.com')).settings.theme).toBe('Sakura');
  });

  it('applies the nine list switches together, and nested keys one at a time', async () => {
    await call('kim@x.com', '/api/me/settings', 'PUT', { settings: { tabs: { games: false, animeSeasons: false }, nav: { side: 'right', collapsed: true } } });
    await setDefaults({ lists: ['anime'], navSide: 'left', navCollapsed: false, animeSeasons: true });
    await call(ADMIN, '/api/admin/defaults/apply', 'POST', { key: 'lists' });
    await call(ADMIN, '/api/admin/defaults/apply', 'POST', { key: 'navSide' });
    const kim = await meOf('kim@x.com');
    expect(kim.settings.tabs).toMatchObject({ anime: true, games: false, movies: false, animeSeasons: false });
    expect(kim.settings.nav).toEqual({ side: 'left', collapsed: true });
    expect(kim.customized).toEqual({ tabs: { animeSeasons: true }, nav: { collapsed: true } });
  });

  it('keeps tiers and uses one UPDATE for tracked accounts (queries stay small once nobody is legacy)', async () => {
    await env.DB.exec(`UPDATE users SET settings_json = '{"customized":{}}' WHERE settings_json = '{}' OR settings_json LIKE '{"theme"%'`);
    await env.DB.prepare(`UPDATE users SET settings_json = '{"customized":{},"tiers":{"anime":{"names":["a","b","c","d"],"bounds":[3,6,8]}}}' WHERE id = 'uKim'`).run();
    await call(ADMIN, '/api/me'); // admin row (legacy) gets read only
    await env.DB.exec(`UPDATE users SET settings_json = '{"customized":{}}' WHERE email = 'dan@x.com'`);
    await setDefaults({ theme: 'Ocean' });
    const spy = spyD1(env.DB);
    const res = await call(ADMIN, '/api/admin/defaults/apply', 'POST', { key: 'theme' }, spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(6);
    expect(spy.binds.filter((b) => /UPDATE users/.test(b.sql))).toHaveLength(1);
    expect((await saved('uKim')).tiers.anime.bounds).toEqual([3, 6, 8]);
  });
});

describe('GET /api/admin/app', () => {
  it('says how many active people Apply to everyone reaches', async () => {
    expect((await json(await call(ADMIN, '/api/admin/app'))).people).toBe(4);
  });
});

describe('shared validator reaches the route', () => {
  it('rejects a bad default and fills a partial one from the built-ins', async () => {
    for (const bad of [{ theme: 'Custom' }, { compareAsk: 'Maybe' }, { navSide: 'top' }, { device: { navWidth: 100 } }, { device: { chatTextSize: 90 } }, { notify: { nope: true } }]) {
      expect((await call(ADMIN, '/api/admin/app/defaults', 'PUT', { value: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await json(await call(ADMIN, '/api/admin/app/defaults', 'PUT', { value: { navSide: 'right' } }));
    expect(ok.value).toMatchObject({ navSide: 'right', theme: 'Midnight', device: { navWidth: null, chatTextSize: 100 } });
    // Device-only starting values are public (the app reads them before anything is saved on the device).
    await call(ADMIN, '/api/admin/app/defaults', 'PUT', { value: { device: { navWidth: 300, activityTextSize: 125 } } });
    expect((await json(await call(null, '/api/app'))).device).toMatchObject({ navWidth: 300, activityTextSize: 125 });
  });
});
