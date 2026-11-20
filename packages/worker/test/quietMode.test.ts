import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_SETTINGS, QUIET_MS, type Entry } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';

const A = 'quiet@example.com';
const as = (path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
  );
const putSettings = (settings: unknown) => as('/api/me/settings', 'PUT', { settings });
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const rows = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM activity').first<{ n: number }>())!.n;
const setQuiet = async (v: string | null) => {
  await as('/api/me');
  const row = await env.DB.prepare('SELECT settings_json FROM users').first<{ settings_json: string }>();
  const s = JSON.parse(row!.settings_json) as Record<string, unknown>;
  if (v === null) delete s.quietUntil; else s.quietUntil = v;
  await env.DB.prepare('UPDATE users SET settings_json = ?').bind(JSON.stringify(s)).run();
};
const mk = async (body: Record<string, unknown>) => ((await (await as('/api/entries', 'POST', { category: 'anime', ...body })).json()) as { entry: Entry }).entry;

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('quiet mode settings', () => {
  it('defaults to null; saves an ISO time and clears with null; is not marked customized', async () => {
    const me = (await (await as('/api/me')).json()) as { settings: { quietUntil: unknown } };
    expect(me.settings.quietUntil).toBeNull();
    const until = iso(QUIET_MS);
    const res = await putSettings({ quietUntil: until });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: { quietUntil: string }; customized: Record<string, unknown> };
    expect(body.settings.quietUntil).toBe(until);
    expect(body.customized.quietUntil).toBeUndefined();
    expect(((await (await as('/api/me')).json()) as { settings: { quietUntil: string } }).settings.quietUntil).toBe(until);
    const off = (await (await putSettings({ quietUntil: null })).json()) as { settings: { quietUntil: unknown } };
    expect(off.settings.quietUntil).toBeNull();
    expect(JSON.parse((await env.DB.prepare('SELECT settings_json FROM users').first<{ settings_json: string }>())!.settings_json)).not.toHaveProperty('quietUntil');
  });

  it('refuses junk, and a time more than a day ahead', async () => {
    await as('/api/me');
    for (const v of ['soon', 5, true, {}, 'x'.repeat(50), iso(3 * QUIET_MS)]) expect((await putSettings({ quietUntil: v })).status).toBe(400);
  });

  it('admin Defaults do not touch it: apply-to-everyone leaves quietUntil alone', async () => {
    const until = iso(QUIET_MS / 2);
    await setQuiet(until);
    const me = (await (await as('/api/me')).json()) as { settings: Record<string, unknown> };
    expect(me.settings.quietUntil).toBe(until);
    expect(Object.keys(DEFAULT_USER_SETTINGS)).toContain('quietUntil');
  });

  it('an unreadable stored value reads as off', async () => {
    await setQuiet('garbage');
    expect(((await (await as('/api/me')).json()) as { settings: { quietUntil: unknown } }).settings.quietUntil).toBeNull();
  });
});

describe('quiet mode and Activity', () => {
  it('while on, nothing posts: new title, rate, re-rate, status, season rating; everything still saves', async () => {
    await setQuiet(iso(QUIET_MS / 2));
    const e = await mk({ title: 'Frieren', rating: 8, status: 'Completed' });
    expect(e).toMatchObject({ rating: 8, status: 'Completed' });
    for (const body of [{ rating: 9 }, { rating: 9.5 }, { status: 'Dropped' }]) {
      const res = await as(`/api/entries/${e.id}`, 'PATCH', body);
      expect(res.status).toBe(200);
    }
    const season = await as(`/api/entries/${e.id}/seasons`, 'POST', { label: 'S1', rating: 7 });
    expect(season.status).toBe(201);
    const s = (await season.json()) as { id: string };
    expect((await as(`/api/seasons/${s.id}`, 'PATCH', { rating: 8 })).status).toBe(200);
    expect(await rows()).toBe(0);
    const saved = (await (await as(`/api/entries/${e.id}`)).json()) as Entry;
    expect(saved).toMatchObject({ rating: 9.5, status: 'Dropped' });
  });

  it('after it expires, rows are written again', async () => {
    await setQuiet(iso(-1000));
    const e = await mk({ title: 'Late', rating: 8 });
    await as(`/api/entries/${e.id}`, 'PATCH', { rating: 9 });
    expect(await rows()).toBeGreaterThan(0);
  });

  it('turning it off brings posts back', async () => {
    await setQuiet(iso(QUIET_MS / 2));
    await mk({ title: 'Hidden', rating: 8 });
    expect(await rows()).toBe(0);
    await putSettings({ quietUntil: null });
    await mk({ title: 'Shown', rating: 8 });
    expect(await rows()).toBe(1);
  });
});
