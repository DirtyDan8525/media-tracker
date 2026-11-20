import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { validateEntryInput } from '../src/api/entries';
import { isValidDay } from '../src/api/entryValidation';
import { spyD1 } from './d1spy';

// Phase 7: custom tags, "More stats" columns and their auto-fill.
const A = 'a@example.com'; // owner
const B = 'b@example.com'; // friend of A
const S = 's@example.com'; // stranger

const as = (email: string, path: string, method = 'GET', body?: unknown, db?: D1Database) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
const anon = (path: string) =>
  app.fetch(new Request(`https://app.test${path}`), { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: '' } as Env);
const json = async <T = any>(res: Response) => (await res.json()) as T;
const uid = async (email: string) => (await json<{ id: string }>(await as(email, '/api/me'))).id;
const mk = async (email: string, body: Record<string, unknown>) => {
  const res = await as(email, '/api/entries', 'POST', { category: 'anime', ...body });
  expect(res.status).toBe(201);
  return (await json<{ entry: any }>(res)).entry;
};
const tag = (email: string, id: string, name: unknown) => as(email, `/api/entries/${id}/tags`, 'POST', { name });
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  for (const [email, name] of [[A, 'dan'], [B, 'ren'], [S, 'sam']] as const) {
    expect((await as(email, '/api/me/username', 'PUT', { username: name })).status).toBe(200);
  }
  await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
  await as(B, `/api/friends/${await uid(A)}/accept`, 'POST');
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('tags API', () => {
  it('creates a tag on first use, trims the name and lists it with its count', async () => {
    const e = await mk(A, { title: 'Frieren' });
    const res = await tag(A, e.id, '  With   Ren ');
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ tags: ['With Ren'] });
    const e2 = await mk(A, { title: 'Invincible' });
    await tag(A, e2.id, 'with ren'); // same tag, any case
    await tag(A, e2.id, 'Comfy');
    const list = await json<{ id: string; name: string; count: number }[]>(await as(A, '/api/tags'));
    expect(list.map((t) => [t.name, t.count])).toEqual([['Comfy', 1], ['With Ren', 2]]);
  });

  it('is idempotent and removes by name, any case', async () => {
    const e = await mk(A, { title: 'Frieren' });
    await tag(A, e.id, 'Rewatch');
    expect(await json(await tag(A, e.id, 'REWATCH'))).toEqual({ tags: ['Rewatch'] });
    const del = await as(A, `/api/entries/${e.id}/tags/${encodeURIComponent('rewatch')}`, 'DELETE');
    expect(del.status).toBe(200);
    expect(await json(del)).toEqual({ tags: [] });
    // The tag itself stays in my list until I delete it in Settings.
    expect((await json<unknown[]>(await as(A, '/api/tags'))).length).toBe(1);
  });

  it('refuses bad names', async () => {
    const e = await mk(A, { title: 'Frieren' });
    for (const bad of ['', '   ', 'x'.repeat(31), 5, null, undefined]) expect((await tag(A, e.id, bad)).status, String(bad)).toBe(400);
    expect((await tag(A, e.id, 'x'.repeat(30))).status).toBe(201);
  });

  it('limits 50 tags per person and 20 per title', async () => {
    const e = await mk(A, { title: 'Frieren' });
    for (let i = 0; i < 20; i++) expect((await tag(A, e.id, `t${i}`)).status).toBe(201);
    const over = await tag(A, e.id, 't20');
    expect(over.status).toBe(409);
    expect((await json(over)).error).toBe('entry_tag_limit');
    const other = await mk(A, { title: 'Other' });
    for (let i = 20; i < 40; i++) expect((await tag(A, other.id, `t${i}`)).status).toBe(201);
    const more = await mk(A, { title: 'More' });
    for (let i = 40; i < 50; i++) expect((await tag(A, more.id, `t${i}`)).status).toBe(201);
    const third = await mk(A, { title: 'Third' });
    const full = await tag(A, third.id, 'one-too-many');
    expect(full.status).toBe(409);
    expect((await json(full)).error).toBe('tag_limit');
    expect((await tag(A, third.id, 't3')).status).toBe(201); // an existing tag still goes on
  });

  it('keeps each person\'s tags to themselves', async () => {
    const mine = await mk(A, { title: 'Mine' });
    await tag(A, mine.id, 'Secret');
    expect((await tag(S, mine.id, 'Nope')).status).toBe(404);
    expect((await as(S, `/api/entries/${mine.id}/tags/Secret`, 'DELETE')).status).toBe(404);
    expect(await json(await as(S, '/api/tags'))).toEqual([]);
    // The same name is a separate tag for someone else.
    const theirs = await mk(S, { title: 'Theirs' });
    await tag(S, theirs.id, 'secret');
    const [t] = await json<{ id: string }[]>(await as(A, '/api/tags'));
    expect((await as(S, `/api/tags/${t!.id}`, 'PATCH', { name: 'Hacked' })).status).toBe(404);
    expect((await as(S, `/api/tags/${t!.id}`, 'DELETE')).status).toBe(404);
    expect((await json<unknown[]>(await as(A, '/api/tags'))).length).toBe(1);
  });

  it('renames everywhere and refuses a name another tag has', async () => {
    const e = await mk(A, { title: 'Frieren' });
    await tag(A, e.id, 'Old');
    await tag(A, e.id, 'Taken');
    const [taken, old] = await json<{ id: string; name: string }[]>(await as(A, '/api/tags')).then((l) => [l.find((t) => t.name === 'Taken')!, l.find((t) => t.name === 'Old')!] as const);
    expect((await as(A, `/api/tags/${old.id}`, 'PATCH', { name: 'taken' })).status).toBe(409);
    expect((await as(A, `/api/tags/${old.id}`, 'PATCH', { name: '' })).status).toBe(400);
    expect((await as(A, `/api/tags/${old.id}`, 'PATCH', { name: 'New' })).status).toBe(200);
    expect((await as(A, `/api/tags/${old.id}`, 'PATCH', { name: 'NEW' })).status).toBe(200); // case-only change of itself
    expect((await json<any>(await as(A, `/api/entries/${e.id}`))).tags).toEqual(['NEW', 'Taken']);
    expect(taken.id).toBeTruthy();
    expect((await as(A, '/api/tags/nope', 'PATCH', { name: 'X' })).status).toBe(404);
  });

  it('deletes a tag from every title, and a title takes its tags with it', async () => {
    const e = await mk(A, { title: 'Frieren' });
    const f = await mk(A, { title: 'Other' });
    await tag(A, e.id, 'Gone');
    await tag(A, f.id, 'Gone');
    await tag(A, f.id, 'Stays');
    const [gone] = (await json<{ id: string; name: string }[]>(await as(A, '/api/tags'))).filter((t) => t.name === 'Gone');
    expect((await as(A, `/api/tags/${gone!.id}`, 'DELETE')).status).toBe(204);
    expect((await json<any>(await as(A, `/api/entries/${e.id}`))).tags).toEqual([]);
    expect((await json<any>(await as(A, `/api/entries/${f.id}`))).tags).toEqual(['Stays']);
    expect((await as(A, `/api/entries/${f.id}`, 'DELETE')).status).toBe(204);
    const { results } = await env.DB.prepare('SELECT * FROM entry_tags').all();
    expect(results).toEqual([]);
    expect((await as(A, `/api/tags/${gone!.id}`, 'DELETE')).status).toBe(404);
  });
});

describe('tags on payloads', () => {
  it('rides on the list, single and export reads in the same queries (A-Z)', async () => {
    const e = await mk(A, { title: 'Frieren' });
    await mk(A, { title: 'Bare' });
    await tag(A, e.id, 'zeta');
    await tag(A, e.id, 'Alpha');
    const list = await json<any[]>(await as(A, '/api/entries?category=anime'));
    expect(list.find((x) => x.id === e.id).tags).toEqual(['Alpha', 'zeta']);
    expect(list.find((x) => x.title === 'Bare').tags).toEqual([]);
    expect((await json<any>(await as(A, `/api/entries/${e.id}`))).tags).toEqual(['Alpha', 'zeta']);
    expect((await json<any>(await as(A, '/api/export'))).entries.find((x: any) => x.id === e.id).tags).toEqual(['Alpha', 'zeta']);
  });

  it('adds no queries: a list of many tagged titles is still one read', async () => {
    for (let i = 0; i < 5; i++) {
      const e = await mk(A, { title: `T${i}` });
      await tag(A, e.id, 'one');
      await tag(A, e.id, `two${i}`);
    }
    await as(A, '/api/me'); // sign-in cost settled
    const spy = spyD1(env.DB);
    await as(A, '/api/entries?category=anime', 'GET', undefined, spy.db);
    const warm = spy.queries;
    spy.reset();
    await as(A, '/api/entries?category=anime', 'GET', undefined, spy.db);
    expect(spy.queries).toBe(warm);
    const e1 = await mk(A, { title: 'More' });
    await tag(A, e1.id, 'three');
    spy.reset();
    await as(A, '/api/entries?category=anime', 'GET', undefined, spy.db);
    expect(spy.queries).toBe(warm); // not per entry, not per tag
    expect(warm).toBeLessThanOrEqual(4); // sign-in (1-3) plus the one list read
  });

  it('shows friends tags on visible titles, never on private ones', async () => {
    const pub = await mk(A, { title: 'Public', rating: 8 });
    const priv = await mk(A, { title: 'Hidden', rating: 9, isPrivate: true });
    await tag(A, pub.id, 'With Ren');
    await tag(A, priv.id, 'Embarrassing');
    const list = await json<any[]>(await as(B, '/api/users/dan/entries'));
    expect(list.map((x) => x.title)).toEqual(['Public']);
    expect(list[0].tags).toEqual(['With Ren']);
    const one = await json<any>(await as(B, `/api/users/dan/entries/${pub.id}`));
    expect(one.entry.tags).toEqual(['With Ren']);
    expect((await as(B, `/api/users/dan/entries/${priv.id}`)).status).toBe(404);
    const feed = await json<any[]>(await as(B, '/api/friends/entries'));
    const text = JSON.stringify(feed);
    expect(text).toContain('With Ren');
    expect(text).not.toContain('Embarrassing');
    expect(JSON.stringify(await json(await as(S, '/api/users/dan/entries')))).not.toContain('With Ren');
    // Turning a title private takes its tags away from friends at once.
    expect((await as(A, `/api/entries/${pub.id}`, 'PATCH', { isPrivate: true })).status).toBe(200);
    expect(JSON.stringify(await json(await as(B, '/api/users/dan/entries')))).not.toContain('With Ren');
  });

  it('follows the same rule on a public link', async () => {
    const pub = await mk(A, { title: 'Public' });
    const priv = await mk(A, { title: 'Hidden', isPrivate: true });
    await tag(A, pub.id, 'Shown');
    await tag(A, priv.id, 'Private tag');
    const { link } = await json<{ link: string }>(await as(A, '/api/me/public-link', 'POST'));
    const token = link.split('/p/')[1]!;
    const res = await anon(`/api/public/${token}/entries`);
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(body.map((x) => [x.title, x.tags])).toEqual([['Public', ['Shown']]]);
    expect(JSON.stringify(body)).not.toContain('Private tag');
  });
});

describe('More stats columns', () => {
  it('validates dates and rewatches', () => {
    const ok = (v: Record<string, unknown>) => validateEntryInput(v, 'patch', 'anime').ok;
    expect(ok({ startedAt: '2025-09-29' })).toBe(true);
    expect(ok({ startedAt: null, finishedAt: null })).toBe(true);
    for (const bad of ['2025-9-29', '2025-02-30', '29/09/2025', '', 20250929, '1800-01-01', '2999-01-01', '2025-13-01']) {
      expect(ok({ startedAt: bad }), String(bad)).toBe(false);
      expect(ok({ finishedAt: bad }), String(bad)).toBe(false);
    }
    expect(ok({ rewatches: 0 })).toBe(true);
    expect(ok({ rewatches: 999 })).toBe(true);
    for (const bad of [-1, 1.5, 1000, '2', null]) expect(ok({ rewatches: bad }), String(bad)).toBe(false);
    expect(isValidDay(today())).toBe(true);
    expect(isValidDay('2100-01-01', Date.parse('2026-11-19'))).toBe(false);
  });

  it('stores and clears them through PATCH, and defaults are empty', async () => {
    const e = await mk(A, { title: 'Frieren' });
    expect(e).toMatchObject({ startedAt: null, finishedAt: null, rewatches: 0 });
    const res = await as(A, `/api/entries/${e.id}`, 'PATCH', { startedAt: '2025-09-29', finishedAt: '2026-03-22', rewatches: 2 });
    expect(await json(res)).toMatchObject({ startedAt: '2025-09-29', finishedAt: '2026-03-22', rewatches: 2 });
    const cleared = await as(A, `/api/entries/${e.id}`, 'PATCH', { startedAt: null });
    expect(await json(cleared)).toMatchObject({ startedAt: null, finishedAt: '2026-03-22' });
    expect((await as(A, `/api/entries/${e.id}`, 'PATCH', { startedAt: '2025-02-31' })).status).toBe(400);
  });

  it('fills Started the first time the status turns active, and Finished on Completed, only when empty', async () => {
    const e = await mk(A, { title: 'Frieren', status: 'Plan to watch' });
    expect(e.startedAt).toBeNull();
    const watching = await json<any>(await as(A, `/api/entries/${e.id}`, 'PATCH', { status: 'Watching / In Progress' }));
    expect(watching.startedAt).toBe(today());
    expect(watching.finishedAt).toBeNull();
    // Edit Started, go on hold and back: it stays what the person set.
    await as(A, `/api/entries/${e.id}`, 'PATCH', { startedAt: '2025-01-02' });
    await as(A, `/api/entries/${e.id}`, 'PATCH', { status: 'On Hold' });
    const again = await json<any>(await as(A, `/api/entries/${e.id}`, 'PATCH', { status: 'Rewatching' }));
    expect(again.startedAt).toBe('2025-01-02');
    const done = await json<any>(await as(A, `/api/entries/${e.id}`, 'PATCH', { status: 'Completed' }));
    expect(done.finishedAt).toBe(today());
    await as(A, `/api/entries/${e.id}`, 'PATCH', { finishedAt: '2026-03-22' });
    await as(A, `/api/entries/${e.id}`, 'PATCH', { status: 'Dropped' });
    const redo = await json<any>(await as(A, `/api/entries/${e.id}`, 'PATCH', { status: 'Completed' }));
    expect(redo.finishedAt).toBe('2026-03-22');
  });

  it('lets a date sent with the status win, even a cleared one, and fills on create', async () => {
    const e = await mk(A, { title: 'Frieren' });
    const sent = await json<any>(await as(A, `/api/entries/${e.id}`, 'PATCH', { status: 'Completed', finishedAt: '2024-05-06' }));
    expect(sent.finishedAt).toBe('2024-05-06');
    const cleared = await json<any>(await as(A, `/api/entries/${sent.id}`, 'PATCH', { status: 'Rewatching', startedAt: null }));
    expect(cleared.startedAt).toBeNull();
    const done = await mk(A, { title: 'Done already', status: 'Completed' });
    expect(done.finishedAt).toBe(today());
    expect(done.startedAt).toBeNull();
    const playing = await mk(A, { title: 'Now', status: 'Watching / In Progress' });
    expect(playing.startedAt).toBe(today());
    expect((await as(A, '/api/entries', 'POST', { category: 'anime', title: 'Bad', startedAt: 'soon' })).status).toBe(400);
  });

  it('adds no queries to a status PATCH', async () => {
    const e = await mk(A, { title: 'Frieren' });
    await as(A, '/api/me');
    const spy = spyD1(env.DB);
    await as(A, `/api/entries/${e.id}`, 'PATCH', { notes: 'warm' }, spy.db);
    const plain = spy.queries;
    const e2 = await mk(A, { title: 'Second' });
    spy.reset();
    await as(A, `/api/entries/${e2.id}`, 'PATCH', { status: 'Completed' }, spy.db);
    // The status change itself adds the activity lookups (0-2) and plan-order cleanup, never an extra read for the dates.
    expect(spy.queries).toBeLessThanOrEqual(plain + 2);
    expect(spy.queries).toBeLessThanOrEqual(8);
  });
});
