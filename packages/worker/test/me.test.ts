import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { sanitizeSettings } from '../src/api/me';
import type { Env } from '../src/env';
import { DEFAULT_USER_SETTINGS } from '@media-tracker/shared';

// Two users: each request overrides DEV_EMAIL (dev bypass signs that user in).
const as = (email: string, path: string, method = 'GET', body?: unknown, raw?: string) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );

const putUsername = (email: string, username: unknown) => as(email, '/api/me/username', 'PUT', { username });
const putSettings = (email: string, settings: unknown) => as(email, '/api/me/settings', 'PUT', { settings });

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('PUT /api/me/username', () => {
  it('sets a valid username and returns the me shape', async () => {
    const res = await putUsername('a@example.com', 'dan_r');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: 'a@example.com', username: 'dan_r', isAdmin: false });
    const me = (await (await as('a@example.com', '/api/me')).json()) as { username: string };
    expect(me.username).toBe('dan_r');
  });

  it('lowercases before storing', async () => {
    const res = await putUsername('a@example.com', 'Dan_R');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { username: string }).username).toBe('dan_r');
  });

  it('409 when another user has it, case-insensitively', async () => {
    expect((await putUsername('a@example.com', 'dan_r')).status).toBe(200);
    const res = await putUsername('b@example.com', 'Dan_R');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'taken' });
  });

  it('allows re-setting your own username', async () => {
    await putUsername('a@example.com', 'dan_r');
    expect((await putUsername('a@example.com', 'DAN_R')).status).toBe(200);
  });

  it('the NOCASE unique index itself rejects a differently-cased duplicate', async () => {
    await putUsername('a@example.com', 'dan_r');
    await as('b@example.com', '/api/me');
    await expect(
      env.DB.prepare("UPDATE users SET username = 'DAN_R' WHERE email = 'b@example.com'").run(),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it.each(['ab', 'has space', 'émoji😀', 'a'.repeat(21), '', 'bad-dash'])('400 for %j', async (name) => {
    const res = await putUsername('a@example.com', name);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
  });

  it('400 for a non-string, a missing field, or non-JSON', async () => {
    expect((await putUsername('a@example.com', 123)).status).toBe(400);
    expect((await as('a@example.com', '/api/me/username', 'PUT', {})).status).toBe(400);
    expect((await as('a@example.com', '/api/me/username', 'PUT', undefined, 'not json')).status).toBe(400);
  });
});

describe('PUT /api/me/settings', () => {
  it('accepts the shape the Sheet importer produces (canonical enums, lowercase hex colours, 8 tab keys)', async () => {
    const imported = {
      theme: 'Ocean', colors: { Background: '#0f1c2b' },
      tabs: { movies: true, tv: true, tvSeasons: true, animeSeasons: true, albums: true, songs: false, games: true, books: true },
      compareAsk: 'Only when I start it', compareStyle: 'Swap the numbers', compareRoom: 'Give the same score', compareWindow: 1.5,
    };
    const res = await putSettings('a@example.com', imported);
    expect(res.status).toBe(200);
  });

  it('accepts the Sheet season tab switches (animeSeasons / tvSeasons) and defaults them on', async () => {
    const res = await putSettings('a@example.com', { tabs: { animeSeasons: false, tvSeasons: false } });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as { settings: { tabs: Record<string, boolean> } };
    expect(settings.tabs).toMatchObject({ animeSeasons: false, tvSeasons: false, anime: true });
    expect(DEFAULT_USER_SETTINGS.tabs).toMatchObject({ animeSeasons: true, tvSeasons: true });
  });

  it('merges a partial update and keeps the other keys', async () => {
    const res = await putSettings('a@example.com', { theme: 'Ocean' });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as { settings: Record<string, unknown> };
    expect(settings).toEqual({ ...DEFAULT_USER_SETTINGS, theme: 'Ocean' });
    const me = (await (await as('a@example.com', '/api/me')).json()) as { settings: Record<string, unknown> };
    expect(me.settings.theme).toBe('Ocean');
    expect(me.settings.compareAsk).toBe('Both');
  });

  it('merges tabs and colors per key across requests', async () => {
    await putSettings('a@example.com', { tabs: { anime: false }, colors: { Background: '#000000' } });
    const res = await putSettings('a@example.com', { tabs: { books: false }, colors: { Text: '#FFFFFF' } });
    const { settings } = (await res.json()) as { settings: { tabs: Record<string, boolean>; colors: Record<string, string> } };
    expect(settings.tabs).toMatchObject({ anime: false, books: false, movies: true });
    expect(settings.colors).toEqual({ Background: '#000000', Text: '#FFFFFF' });
  });

  it('drops unknown keys silently', async () => {
    const res = await putSettings('a@example.com', { theme: 'Forest', evil: 1, tabs: { nope: true, tv: false }, colors: { Nope: '#000000' } });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as { settings: Record<string, any> };
    expect(settings.evil).toBeUndefined();
    expect(settings.tabs.nope).toBeUndefined();
    expect(settings.tabs.tv).toBe(false);
    expect(settings.colors).toEqual({});
    const row = await env.DB.prepare('SELECT settings_json FROM users').first<{ settings_json: string }>();
    expect(row?.settings_json).not.toContain('evil');
  });

  it('400 on an invalid value and saves nothing', async () => {
    const res = await putSettings('a@example.com', { theme: 'Ocean', compareAsk: 'Sometimes' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    const me = (await (await as('a@example.com', '/api/me')).json()) as { settings: { theme: string } };
    expect(me.settings.theme).toBe('Midnight');
  });

  it('400 on non-JSON, missing settings, or non-object settings', async () => {
    expect((await as('a@example.com', '/api/me/settings', 'PUT', undefined, '{')).status).toBe(400);
    expect((await as('a@example.com', '/api/me/settings', 'PUT', {})).status).toBe(400);
    expect((await putSettings('a@example.com', [1])).status).toBe(400);
    expect((await putSettings('a@example.com', 'x')).status).toBe(400);
  });

  it('ignores prototype keys', async () => {
    const raw = '{"settings":{"tabs":{"__proto__":{"x":true}},"colors":{"constructor":"#000000"}}}';
    const res = await as('a@example.com', '/api/me/settings', 'PUT', undefined, raw);
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT settings_json FROM users').first<{ settings_json: string }>();
    const stored = JSON.parse(row!.settings_json);
    expect(Object.keys(stored.tabs)).not.toContain('x');
    expect(Object.keys(stored.tabs)).not.toContain('__proto__');
    expect(Object.keys(stored.colors)).toEqual([]);
    expect(({} as any).x).toBeUndefined();
  });

  it('does not touch other users', async () => {
    await putSettings('a@example.com', { theme: 'Ocean' });
    const other = (await (await as('b@example.com', '/api/me')).json()) as { settings: { theme: string } };
    expect(other.settings.theme).toBe('Midnight');
  });
});

describe('sanitizeSettings', () => {
  const cur = DEFAULT_USER_SETTINGS;
  const bad = (p: unknown) => expect(sanitizeSettings(p, cur)).toEqual({ ok: false });

  it('accepts each enum value and Custom theme', () => {
    const r = sanitizeSettings(
      { theme: 'Custom', compareAsk: 'Off', compareStyle: 'Swap the numbers', compareRoom: 'Push others down', compareWindow: 10 },
      cur,
    );
    expect(r).toMatchObject({ ok: true, settings: { theme: 'Custom', compareAsk: 'Off', compareWindow: 10 } });
  });

  it('accepts decimal and boundary compareWindow', () => {
    for (const w of [0.5, 1.5, 10]) expect(sanitizeSettings({ compareWindow: w }, cur)).toMatchObject({ ok: true, settings: { compareWindow: w } });
  });

  it('rejects bad values', () => {
    bad({ theme: 'Nope' });
    bad({ theme: 5 });
    bad({ colors: { Background: 'red' } });
    bad({ colors: { Background: '#fff' } });
    bad({ colors: [] });
    bad({ tabs: { anime: 'yes' } });
    bad({ tabs: null });
    bad({ compareStyle: 'x' });
    bad({ compareRoom: 'x' });
    bad({ compareWindow: 0 });
    bad({ compareWindow: -1 });
    bad({ compareWindow: 10.5 });
    bad({ compareWindow: 11 });
    bad({ compareWindow: '2' });
    bad({ compareWindow: NaN });
    bad({ compareWindow: Infinity });
    bad(null);
    bad([]);
  });

  it('does not mutate the current settings', () => {
    const before = JSON.stringify(cur);
    sanitizeSettings({ tabs: { anime: false }, colors: { Text: '#123456' } }, cur);
    expect(JSON.stringify(cur)).toBe(before);
  });
});
