import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CUSTOM_LISTS_MAX, type CustomList } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { settingsWithout } from '../src/api/customLists';
import { forgetAppSettings } from '../src/settings/appSettings';
import { readSettings } from '../src/auth/user';

// Phase 7: custom lists (migration 0020).
const A = 'a@example.com'; // owner
const B = 'b@example.com'; // friend of A
const S = 's@example.com'; // stranger

const as = (email: string, path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
const json = async <T = any>(res: Response) => (await res.json()) as T;
const uid = async (email: string) => (await json<{ id: string }>(await as(email, '/api/me'))).id;

const RESTAURANTS = {
  name: '  Restaurants ', noun: 'restaurant', icon: '🍜', creatorLabel: 'Cuisine', hasStatus: true, statusWords: 'try',
  showTags: true, showYear: false, showGenres: false, showProgress: false, showLink: true, searchSource: null,
};
const makeList = async (email: string, body: Record<string, unknown> = RESTAURANTS) => {
  const res = await as(email, '/api/lists', 'POST', body);
  expect(res.status).toBe(201);
  return (await json<{ list: CustomList; lists: CustomList[] }>(res)).list;
};
const mk = async (email: string, body: Record<string, unknown>) => {
  const res = await as(email, '/api/entries', 'POST', body);
  expect(res.status).toBe(201);
  return (await json<{ entry: any }>(res)).entry;
};

beforeEach(async () => {
  for (const [email, name] of [[A, 'dan'], [B, 'ren'], [S, 'sam']] as const) {
    expect((await as(email, '/api/me/username', 'PUT', { username: name })).status).toBe(200);
  }
  await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
  await as(B, `/api/friends/${await uid(A)}/accept`, 'POST');
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
  await env.DB.exec('DELETE FROM app_settings');
  forgetAppSettings();
});

describe('custom lists CRUD', () => {
  it('creates a list (trimmed, key c_<id>) and /api/me carries it', async () => {
    const l = await makeList(A);
    expect(l).toMatchObject({ name: 'Restaurants', noun: 'restaurant', icon: '🍜', creatorLabel: 'Cuisine', hasStatus: true, statusWords: 'try', showLink: true, searchSource: null });
    expect(l.key).toBe(`c_${l.id}`);
    expect(l.key).toMatch(/^c_[a-z0-9]{10}$/);
    const me = await json(await as(A, '/api/me'));
    expect(me.customLists).toEqual([l]);
    expect(await json(await as(A, '/api/lists'))).toEqual({ lists: [l], max: CUSTOM_LISTS_MAX });
    // Someone else has none.
    expect((await json(await as(B, '/api/me'))).customLists).toEqual([]);
  });

  it('refuses bad input: no name, long noun, two emoji, unknown words or search', async () => {
    for (const bad of [
      { ...RESTAURANTS, name: '   ' },
      { ...RESTAURANTS, name: 'x'.repeat(41) },
      { ...RESTAURANTS, noun: 'x'.repeat(25) },
      { ...RESTAURANTS, icon: '🍜🍣' },
      { ...RESTAURANTS, icon: 'ab' },
      { ...RESTAURANTS, creatorLabel: 'x'.repeat(25) },
      { ...RESTAURANTS, statusWords: 'eat' },
      { ...RESTAURANTS, searchSource: 'anime' },
      { ...RESTAURANTS, showLink: 'yes' },
    ]) {
      expect((await as(A, '/api/lists', 'POST', bad)).status).toBe(400);
    }
  });

  it('edits only what is sent; another person cannot edit or delete it', async () => {
    const l = await makeList(A);
    const res = await as(A, `/api/lists/${l.id}`, 'PATCH', { name: 'Places', showYear: true, icon: '', searchSource: 'music' });
    expect(res.status).toBe(200);
    const { list } = await json(res);
    expect(list).toMatchObject({ name: 'Places', noun: 'restaurant', showYear: true, icon: '', searchSource: 'music', creatorLabel: 'Cuisine' });
    expect((await as(B, `/api/lists/${l.id}`, 'PATCH', { name: 'Mine' })).status).toBe(404);
    expect((await as(B, `/api/lists/${l.id}`, 'DELETE')).status).toBe(404);
    expect((await json(await as(A, '/api/me'))).customLists[0].name).toBe('Places');
  });

  it(`allows ${CUSTOM_LISTS_MAX} lists, then answers 409 with a clear message`, async () => {
    for (let i = 0; i < CUSTOM_LISTS_MAX; i++) await makeList(A, { ...RESTAURANTS, name: `List ${i}` });
    const res = await as(A, '/api/lists', 'POST', { ...RESTAURANTS, name: 'One more' });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'limit', max: 6, message: expect.stringContaining('up to 6 custom lists') });
    // The limit is per person.
    await makeList(B);
  });

  it('the admin switch stops new lists; existing ones keep working', async () => {
    const l = await makeList(A);
    await env.DB.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES ('features', '{\"customLists\":false}', '2026-01-01')").run();
    forgetAppSettings();
    expect(await json(await as(A, '/api/app'))).toMatchObject({ features: { customLists: false } });
    const res = await as(A, '/api/lists', 'POST', { ...RESTAURANTS, name: 'Bars' });
    expect(res.status).toBe(403);
    expect((await as(A, `/api/lists/${l.id}`, 'PATCH', { name: 'Food' })).status).toBe(200);
    await mk(A, { category: l.key, title: 'Joe’s Pho' });
  });
});

describe('titles on a custom list', () => {
  it('adds, reads and filters by the key; status words are labels only', async () => {
    const l = await makeList(A);
    const e = await mk(A, { category: l.key, title: "Joe's Pho", creator: 'Vietnamese', status: 'Completed', rating: 9.1, link: 'https://maps.example.com/joes' });
    expect(e).toMatchObject({ category: l.key, title: "Joe's Pho", creator: 'Vietnamese', status: 'Completed', rating: 9.1, link: 'https://maps.example.com/joes' });
    await mk(A, { category: 'anime', title: 'Frieren' });
    const rows = await json<any[]>(await as(A, `/api/entries?category=${l.key}`));
    expect(rows.map((r) => r.title)).toEqual(["Joe's Pho"]);
    const patched = await json(await as(A, `/api/entries/${e.id}`, 'PATCH', { status: 'Plan to watch', link: '' }));
    expect(patched).toMatchObject({ status: 'Plan to watch', link: '' });
  });

  it('refuses a key that is not yours, or no list at all', async () => {
    const l = await makeList(A);
    expect((await as(B, '/api/entries', 'POST', { category: l.key, title: 'Sneaky' })).status).toBe(400);
    expect((await as(A, '/api/entries', 'POST', { category: 'c_nothinghere', title: 'Ghost' })).status).toBe(400);
    expect((await as(B, `/api/entries?category=${l.key}`)).status).toBe(400);
    expect((await as(B, '/api/entries/plan-order', 'PUT', { category: l.key, ids: ['x'] })).status).toBe(400);
  });

  it('a list without Status refuses a status; a link must be http(s)', async () => {
    const l = await makeList(A, { ...RESTAURANTS, name: 'Wines', hasStatus: false });
    expect((await as(A, '/api/entries', 'POST', { category: l.key, title: 'Rioja', status: 'Completed' })).status).toBe(400);
    expect((await as(A, '/api/entries', 'POST', { category: l.key, title: 'Rioja', link: 'javascript:alert(1)' })).status).toBe(400);
    expect((await as(A, '/api/entries', 'POST', { category: l.key, title: 'Rioja', link: 'ftp://x' })).status).toBe(400);
    const e = await mk(A, { category: l.key, title: 'Rioja' });
    expect(e.status).toBeNull();
    expect((await as(A, `/api/entries/${e.id}/seasons`, 'POST', { label: 'S1' })).status).toBe(400);
  });

  it('is its own rating set: numbers fit and close calls stay inside the list', async () => {
    const l = await makeList(A);
    const x = await mk(A, { category: l.key, title: 'Joe’s Pho', rating: 9.1 });
    const y = await mk(A, { category: l.key, title: 'Taco Loco', rating: 9.05 });
    await mk(A, { category: 'anime', title: 'Frieren', rating: 9.1 });
    const set = await json(await as(A, `/api/ratings/${l.key}`));
    expect(set.items.map((i: any) => i.id).sort()).toEqual([x.id, y.id].sort());
    const close = await json(await as(A, `/api/ratings/${l.key}/close`));
    expect(close.pairs).toEqual([[expect.any(String), expect.any(String)]]);
    expect(new Set(close.pairs[0])).toEqual(new Set([x.id, y.id]));
    const counts = (await json(await as(A, '/api/ratings/close-counts'))).counts;
    expect(counts[l.key]).toBe(1);
    const saved = await as(A, `/api/ratings/${l.key}/save`, 'POST', { picks: [{ winnerId: y.id, loserId: x.id, isTie: false, undone: false }], moves: [], done: [] });
    expect(saved.status).toBe(200);
    // Nobody else's set.
    expect((await as(B, `/api/ratings/${l.key}`)).status).toBe(400);
    expect((await as(B, `/api/ratings/${l.key}/close`)).status).toBe(400);
  });
});

describe('friends, public link, activity', () => {
  it('friends see the lists and the visible titles (private titles and private notes stay hidden); strangers see neither', async () => {
    const l = await makeList(A);
    await mk(A, { category: l.key, title: "Joe's Pho", rating: 9, notes: 'the broth', link: 'https://joes.example' });
    await mk(A, { category: l.key, title: 'Secret Spot', rating: 8, isPrivate: true });
    await mk(A, { category: l.key, title: 'Taco Loco', rating: 7, notes: 'hidden note', notesPrivate: true });
    const header = await json(await as(B, '/api/users/dan'));
    expect(header.lists).toEqual([l]);
    const rows = await json<any[]>(await as(B, `/api/users/dan/entries?category=${l.key}`));
    expect(rows.map((r) => r.title).sort()).toEqual(["Joe's Pho", 'Taco Loco']);
    expect(rows.find((r) => r.title === "Joe's Pho")).toMatchObject({ notes: 'the broth', link: 'https://joes.example', category: l.key });
    expect(rows.find((r) => r.title === 'Taco Loco').notes).toBeNull();
    const one = await json(await as(B, `/api/users/dan/entries/${rows[0].id}`));
    expect(one.list).toEqual(l);
    // A stranger: no lists in the header, no titles.
    expect((await json(await as(S, '/api/users/dan'))).lists).toEqual([]);
    expect((await as(S, `/api/users/dan/entries?category=${l.key}`)).status).toBe(403);
  });

  it('a public link shows the lists and the visible titles', async () => {
    const l = await makeList(A);
    await mk(A, { category: l.key, title: "Joe's Pho", rating: 9 });
    await mk(A, { category: l.key, title: 'Secret Spot', rating: 8, isPrivate: true });
    const { link } = await json(await as(A, '/api/me/public-link', 'POST'));
    const token = link.split('/p/')[1];
    const anon = (p: string) => app.fetch(new Request(`https://app.test${p}`), { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: '' } as Env);
    expect((await json(await anon(`/api/public/${token}`))).lists).toEqual([l]);
    const rows = await json<any[]>(await anon(`/api/public/${token}/entries`));
    expect(rows.map((r) => r.title)).toEqual(["Joe's Pho"]);
  });

  it('activity posts carry the list they sit on', async () => {
    const l = await makeList(A);
    await mk(A, { category: l.key, title: "Joe's Pho", rating: 9 });
    await mk(A, { category: 'anime', title: 'Frieren', rating: 9 });
    const page = await json(await as(B, '/api/activity?show=friends'));
    expect(page.items.map((i: any) => i.category).sort()).toEqual(['anime', l.key].sort());
    expect(page.lists).toEqual({ [l.key]: l });
  });
});

describe('settings and delete', () => {
  it('Settings accept your own list keys in tabs and listOrder, not others', async () => {
    const l = await makeList(A);
    const other = await makeList(B, { ...RESTAURANTS, name: 'Bars' });
    const ok = await as(A, '/api/me/settings', 'PUT', { settings: { tabs: { [l.key]: false }, listOrder: [l.key, 'anime'] } });
    expect(ok.status).toBe(200);
    expect((await json(ok)).settings).toMatchObject({ tabs: { [l.key]: false }, listOrder: [l.key, 'anime'] });
    expect((await as(A, '/api/me/settings', 'PUT', { settings: { listOrder: [other.key] } })).status).toBe(400);
    // Someone else's switch is dropped like any unknown key.
    const res = await json(await as(A, '/api/me/settings', 'PUT', { settings: { tabs: { [other.key]: false } } }));
    expect(res.settings.tabs[other.key]).toBeUndefined();
  });

  it('deleting a list deletes its titles, their picks and the settings that named it; other lists stay', async () => {
    const l = await makeList(A);
    const keep = await makeList(A, { ...RESTAURANTS, name: 'Bars' });
    const x = await mk(A, { category: l.key, title: "Joe's Pho", rating: 9.1 });
    const y = await mk(A, { category: l.key, title: 'Taco Loco', rating: 9.05 });
    await as(A, `/api/entries/${x.id}/tags`, 'POST', { name: 'Fave' });
    await as(A, `/api/ratings/${l.key}/save`, 'POST', { picks: [{ winnerId: y.id, loserId: x.id, isTie: false, undone: false }], moves: [], done: [] });
    const z = await mk(A, { category: keep.key, title: 'The Pub' });
    const anime = await mk(A, { category: 'anime', title: 'Frieren' });
    await as(A, '/api/me/settings', 'PUT', { settings: { tabs: { [l.key]: false }, listOrder: [l.key, keep.key, 'anime'] } });

    const res = await as(A, `/api/lists/${l.id}`, 'DELETE');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ lists: [keep] });
    const left = await env.DB.prepare('SELECT id FROM entries WHERE user_id = ?').bind(await uid(A)).all<{ id: string }>();
    expect(left.results.map((r) => r.id).sort()).toEqual([z.id, anime.id].sort());
    const picks = await env.DB.prepare('SELECT COUNT(*) AS n FROM comparisons WHERE category = ?').bind(l.key).first<{ n: number }>();
    expect(picks!.n).toBe(0);
    const tagged = await env.DB.prepare('SELECT COUNT(*) AS n FROM entry_tags WHERE entry_id = ?').bind(x.id).first<{ n: number }>();
    expect(tagged!.n).toBe(0);
    const me = await json(await as(A, '/api/me'));
    expect(me.customLists).toEqual([keep]);
    expect(me.settings.tabs[l.key]).toBeUndefined();
    expect(me.settings.listOrder).toEqual([keep.key, 'anime']);
    expect(me.customized.tabs?.[l.key]).toBeUndefined();
    expect((await as(A, `/api/lists/${l.id}`, 'DELETE')).status).toBe(404);
  });

  it('settingsWithout drops every trace of a key', () => {
    const { storedSettings } = readSettings(JSON.stringify({ tabs: { c_abcdef1234: false, anime: true }, listOrder: ['c_abcdef1234', 'anime'], tiers: { c_abcdef1234: { names: ['a', 'b', 'c', 'd'], bounds: [6, 7.5, 9] } } }));
    expect(storedSettings.tiers).toHaveProperty('c_abcdef1234');
    const out = settingsWithout(storedSettings, { tabs: { c_abcdef1234: true } }, 'c_abcdef1234') as any;
    expect(out.tabs).not.toHaveProperty('c_abcdef1234');
    expect(out.tiers).not.toHaveProperty('c_abcdef1234');
    expect(out.listOrder).toEqual(['anime']);
    expect(out.customized).toEqual({});
  });

  it('export includes the custom lists and their titles', async () => {
    const l = await makeList(A);
    await mk(A, { category: l.key, title: "Joe's Pho" });
    const body = await json(await as(A, '/api/export'));
    expect(body.customLists).toEqual([l]);
    expect(body.entries.map((e: any) => e.category)).toEqual([l.key]);
  });

  it('the admin backup includes custom_lists', async () => {
    await makeList(A);
    await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').bind(A).run();
    const body = await json(await as(A, '/api/admin/backup'));
    expect(body.tables?.custom_lists ?? body.custom_lists).toHaveLength(1);
  });
});
