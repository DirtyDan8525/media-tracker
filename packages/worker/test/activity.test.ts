import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import type { ActivityPage, Entry, SavePayload } from '@media-tracker/shared';
import { activityForPatch, ratingsSaveActivityRows } from '../src/api/activity';
import { pair } from '../src/social/visibility';
import { spyD1 } from './d1spy';

const A = 'a@example.com';
const B = 'b@example.com';
const C = 'c@example.com';

const as = (email: string, path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );

const mk = async (email: string, body: Record<string, unknown>) => {
  const res = await as(email, '/api/entries', 'POST', { category: 'anime', ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entry: Entry }).entry;
};
const patch = async (email: string, id: string, body: unknown) => {
  const res = await as(email, `/api/entries/${id}`, 'PATCH', body);
  expect(res.status).toBe(200);
};
/** Your own posts (show=you) unless `qs` says otherwise. */
const feed = async (email: string, qs = '?show=you') => {
  const res = await as(email, `/api/activity${qs}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ActivityPage;
};

afterEach(async () => {
  await env.DB.exec('DELETE FROM friendships; DELETE FROM users;');
});

describe('activity writes', () => {
  it('create logs added with rating and status', async () => {
    const e = await mk(A, { title: 'Frieren', rating: 8, status: 'Completed' });
    const { items, next } = await feed(A);
    expect(next).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'added', entryId: e.id, title: 'Frieren', category: 'anime',
      payload: { rating: 8, status: 'Completed' },
    });
  });

  it('patch rating null to 8 logs rated; 8 to 9 logs re-rated; 9 to 9 and 9 to null log nothing', async () => {
    const e = await mk(A, { title: 'X' });
    await patch(A, e.id, { rating: 8 });
    await patch(A, e.id, { rating: 9 });
    await patch(A, e.id, { rating: 9 });
    await patch(A, e.id, { rating: null });
    const { items } = await feed(A);
    expect(items.map((i) => i.type)).toEqual(['re-rated', 'rated', 'added']);
    expect(items[0]!.payload).toEqual({ from: 8, to: 9 });
    expect(items[1]!.payload).toEqual({ from: null, to: 8 });
  });

  it('patch status logs {from,to}; the same status logs nothing; rating+status logs two rows', async () => {
    const e = await mk(A, { title: 'X', status: 'Watching / In Progress' });
    await patch(A, e.id, { status: 'Completed' });
    await patch(A, e.id, { status: 'Completed' });
    let { items } = await feed(A);
    expect(items.map((i) => i.type)).toEqual(['status', 'added']);
    expect(items[0]!.payload).toEqual({ from: 'Watching / In Progress', to: 'Completed' });
    await patch(A, e.id, { rating: 7, status: 'Dropped' });
    ({ items } = await feed(A));
    expect(items).toHaveLength(4);
    expect(items.slice(0, 2).map((i) => i.type).sort()).toEqual(['rated', 'status']);
  });

  it('notes, coverUrl, lookup fills and seasons log nothing', async () => {
    const e = await mk(A, { title: 'X' });
    await patch(A, e.id, { notes: 'n', coverUrl: 'https://img.test/c.jpg', synopsis: 's', lookupState: 'ok' });
    const res = await as(A, `/api/entries/${e.id}/seasons`, 'POST', { label: 'S1', rating: 8 });
    expect(res.status).toBe(201);
    expect((await feed(A)).items.map((i) => i.type)).toEqual(['added']);
  });

  it('import logs nothing', async () => {
    const res = await as(A, '/api/import', 'POST', {
      importId: crypto.randomUUID(),
      rows: [{ category: 'movies', title: 'Imported', status: null, rating: 8, genres: '', creator: '', album: '', coverUrl: '', notes: '' }],
    });
    expect(res.status).toBe(200);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries').first<{ n: number }>();
    expect(n!.n).toBe(1);
    expect((await feed(A)).items).toEqual([]);
  });

  it('deleting the entry removes its rows', async () => {
    const e = await mk(A, { title: 'X', rating: 5 });
    expect((await as(A, `/api/entries/${e.id}`, 'DELETE')).status).toBe(204);
    expect((await feed(A)).items).toEqual([]);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("B never sees A's rows", async () => {
    await mk(A, { title: 'Mine' });
    await mk(B, { title: 'Theirs' });
    expect((await feed(A)).items.map((i) => i.title)).toEqual(['Mine']);
    expect((await feed(B)).items.map((i) => i.title)).toEqual(['Theirs']);
  });
});

describe('GET /api/activity', () => {
  it('120 posts sharing one created_at page 30/30/30/30 with no duplicates', async () => {
    const e = await mk(A, { title: 'X' });
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(A).first<{ id: string }>();
    await env.DB.exec('DELETE FROM activity');
    const ts = '2026-11-15T10:00:00.000Z';
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 120; i++) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES (?, ?, ?, 'rated', '{}', ?, ?)`,
        ).bind(`id${String(i).padStart(3, '0')}`, user!.id, e.id, ts, ts),
      );
    }
    for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));

    const seen: string[] = [];
    const sizes: number[] = [];
    let qs = '?show=you';
    for (let guard = 0; guard < 6; guard++) {
      const page = await feed(A, qs);
      sizes.push(page.items.length);
      seen.push(...page.items.map((i) => i.id));
      if (!page.next) break;
      qs = `?show=you&before=${encodeURIComponent(page.next.before)}&beforeId=${encodeURIComponent(page.next.beforeId)}`;
    }
    expect(sizes).toEqual([30, 30, 30, 30]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('pages posts with mixed created_at values across page boundaries without gaps or duplicates', async () => {
    const e = await mk(A, { title: 'X' });
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(A).first<{ id: string }>();
    await env.DB.exec('DELETE FROM activity');
    const stmts: D1PreparedStatement[] = [];
    const expected: { id: string; at: string }[] = [];
    for (let i = 0; i < 130; i++) {
      // groups of 7 share a timestamp, so page edges (30, 60, …) fall mid-group; ids run against time order
      const at = new Date(Date.UTC(2026, 10, 15, 10, 0, 0) + Math.floor(i / 7) * 1000).toISOString();
      const id = `m${String(999 - i).padStart(4, '0')}`;
      expected.push({ id, at });
      stmts.push(
        env.DB.prepare(
          `INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES (?, ?, ?, 'rated', '{}', ?, ?)`,
        ).bind(id, user!.id, e.id, at, at),
      );
    }
    for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
    expected.sort((x, y) => (x.at === y.at ? (x.id < y.id ? 1 : -1) : x.at < y.at ? 1 : -1));

    const seen: string[] = [];
    let qs = '?show=you';
    for (let guard = 0; guard < 7; guard++) {
      const page = await feed(A, qs);
      seen.push(...page.items.map((i) => i.id));
      if (!page.next) break;
      qs = `?show=you&before=${encodeURIComponent(page.next.before)}&beforeId=${encodeURIComponent(page.next.beforeId)}`;
    }
    expect(seen).toEqual(expected.map((x) => x.id));
  });

  it('before without beforeId is a 400, and so is beforeId without before', async () => {
    expect((await as(A, '/api/activity?before=2026-11-15T10:00:00.000Z')).status).toBe(400);
    expect((await as(A, '/api/activity?beforeId=x')).status).toBe(400);
  });

  it('requires sign-in', async () => {
    const res = await app.fetch(new Request('https://app.test/api/activity'), { ...env, ENVIRONMENT: 'prod' } as Env);
    expect(res.status).toBe(401);
  });
});

describe('migration seed (0003)', () => {
  it('adds one added row per existing non-imported entry at its created_at, and none for imports', async () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0003'));
    const seed = migration?.queries.filter((q) => /INSERT INTO activity/i.test(q));
    expect(seed).toHaveLength(1);

    await mk(A, { title: 'Pre-existing' }); // creates the user
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(A).first<{ id: string }>();
    await env.DB.exec('DELETE FROM activity'); // as if these entries predate the activity table
    const ins = (id: string, importId: string | null, at: string) =>
      env.DB.prepare(
        `INSERT INTO entries (id, user_id, category, title, import_id, created_at, updated_at) VALUES (?, ?, 'anime', ?, ?, ?, ?)`,
      ).bind(id, user!.id, id, importId, at, at);
    await env.DB.batch([
      ins('hand-made', null, '2026-01-02T03:04:05.000Z'),
      ins('imported', 'imp-1', '2026-01-03T00:00:00.000Z'),
    ]);

    await env.DB.prepare(seed![0]!).run();
    const rows = (await env.DB.prepare('SELECT * FROM activity ORDER BY created_at').all<Record<string, string>>()).results;
    const byEntry = Object.fromEntries(rows.map((r) => [r.entry_id, r]));
    expect(Object.keys(byEntry).sort()).toHaveLength(2); // Pre-existing (uuid) + hand-made; never 'imported'
    expect(byEntry.imported).toBeUndefined();
    expect(byEntry['hand-made']).toMatchObject({
      user_id: user!.id, type: 'added', payload_json: '{}',
      created_at: '2026-01-02T03:04:05.000Z', updated_at: '2026-01-02T03:04:05.000Z',
    });
    expect(byEntry['hand-made']!.id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('activity on POST/PATCH /entries, number-first', () => {
  it('a tier key alone is ignored (N10): the create is unrated and a tier PATCH logs nothing', async () => {
    const e = await mk(A, { title: 'Tiered', tier: 2 });
    expect(e.rating).toBeNull();
    await patch(A, e.id, { tier: 3 });
    const { items } = await feed(A);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'added', entryId: e.id, payload: {} });
  });

  it('a lock-only edit logs nothing; neighbours re-written by a retype log nothing', async () => {
    const a = await mk(A, { title: 'A', rating: 9.5 });
    const b = await mk(A, { title: 'B', rating: 9.4 });
    // A pick makes a and b nudged, so a retype of one re-fits the other.
    const res = await as(A, '/api/ratings/anime/save', 'POST', { picks: [{ winnerId: b.id, loserId: a.id, isTie: false, undone: false }], moves: [], done: [] });
    expect(res.status).toBe(200);
    await env.DB.exec('DELETE FROM activity');
    const before = await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(a.id).first<{ rating: number }>();
    await patch(A, b.id, { scoreLocked: true });
    expect((await feed(A)).items).toEqual([]);
    await patch(A, b.id, { rating: 9.3 });
    const after = await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(a.id).first<{ rating: number }>();
    expect(after!.rating).not.toBe(before!.rating); // a was re-fitted …
    const { items } = await feed(A);
    expect(items.map((i) => i.entryId)).toEqual([b.id]); // … but only the edited title logs
    expect(items[0]).toMatchObject({ type: 're-rated' });
  });
});

describe('activity on POST /api/ratings/:set/save', () => {
  const save = (p: Partial<SavePayload>, db?: D1Database) =>
    app.fetch(
      new Request('https://app.test/api/ratings/anime/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ picks: [], moves: [], done: [], ...p }),
      }),
      { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );
  const pick = (winnerId: string, loserId: string, undone = false) => ({ winnerId, loserId, isTie: false, undone });
  const logged = async () => (await feed(A)).items.filter((i) => i.type !== 'added');

  it('a close-call pick logs nothing (a nudge is at most 0.2)', async () => {
    const a = await mk(A, { title: 'A', rating: 9.6 });
    const b = await mk(A, { title: 'B', rating: 9.6 });
    expect((await save({ picks: [pick(b.id, a.id)] })).status).toBe(200);
    expect(await logged()).toEqual([]);
  });

  it('a 1000-pick save stays within D1 limits (≤ 100 params, ≤ 10 queries)', async () => {
    const user = await (async () => { await feed(A); return (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(A).first<{ id: string }>())!.id; })();
    const ids = Array.from({ length: 1000 }, () => crypto.randomUUID());
    const stmts = ids.map((id, i) => env.DB.prepare(
      `INSERT INTO entries (id, user_id, category, title, rating, typed, created_at, updated_at) VALUES (?, ?, 'anime', ?, ?, ?, ?, ?)`,
    ).bind(id, user, `T${i}`, 6.2 + (i % 8) / 10, 6.2 + (i % 8) / 10, new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), '2026-01-01T00:00:00.000Z'));
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    const picks = Array.from({ length: 1000 }, (_, i) => pick(ids[i]!, ids[(i * 8 + 8) % 1000]!));
    const spy = spyD1(env.DB);
    const res = await save({ picks }, spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(10);
    expect(spy.maxParams).toBeLessThanOrEqual(100);
    expect(await logged()).toEqual([]);
  });
});

describe('ratingsSaveActivityRows', () => {
  const st = (id: string, rating: number | null, tier: number | null) => ({ id, rating, tier });
  const before = new Map([
    ['same', st('same', 8, 2)], ['small', st('small', 8, 2)], ['half', st('half', 8, 2)], ['tier', st('tier', 8.9, 2)],
    ['first', st('first', null, null)], ['refit', st('refit', 8, 2)], ['cleared', st('cleared', 8, 2)],
  ]);
  const changed = [
    st('same', 8, 2), st('small', 8.49, 2), st('half', 8.5, 2), st('tier', 9.03, 3),
    st('first', 8.25, 2), st('refit', 6.1, 1), st('cleared', null, null),
  ];

  it('logs session titles that moved ≥ 0.5, changed tier or got a first rating; never re-fit-only rows', () => {
    const session = new Set(['same', 'small', 'half', 'tier', 'first', 'cleared']);
    expect(ratingsSaveActivityRows(before, changed, session)).toEqual([
      { id: 'half', rating: 8.5 }, { id: 'tier', rating: 9.03 }, { id: 'first', rating: 8.25 },
    ]);
  });

  it('a 0.5 drop counts like a 0.5 rise, despite float error', () => {
    const b = new Map([['x', st('x', 8.3, 2)]]);
    expect(ratingsSaveActivityRows(b, [st('x', 7.8, 2)], new Set(['x']))).toEqual([{ id: 'x', rating: 7.8 }]);
  });
});

// ---- Phase 4: posts (S5), scoped feed (S6), social counts, unread (S8) ----

const idOf = async (email: string) => {
  await as(email, '/api/me');
  return (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())!.id;
};
const befriend = async (x: string, y: string, status: 'accepted' | 'pending' = 'accepted') => {
  const [a, b] = pair(await idOf(x), await idOf(y));
  await env.DB.prepare('INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(a, b, status, await idOf(x), '2026-11-01T00:00:00.000Z').run();
};
const rows = async (entryId: string) =>
  (await env.DB.prepare('SELECT id, post_id, type FROM activity WHERE entry_id = ? ORDER BY created_at, rowid').bind(entryId)
    .all<{ id: string; post_id: string | null; type: string }>()).results;
const postOf = (r: { id: string; post_id: string | null }) => r.post_id ?? r.id;
const T = Date.parse('2026-11-16T12:00:00.000Z');
const at = (min: number) => new Date(T + min * 60_000).toISOString();
/** A rating change written by the PATCH builder at a chosen time, then the stored row updated. */
const rateAt = async (userId: string, entryId: string, rating: number, now: string) => {
  await env.DB.batch([
    ...activityForPatch(env.DB, userId, entryId, { rating }, now),
    env.DB.prepare('UPDATE entries SET rating = ? WHERE id = ?').bind(rating, entryId),
  ]);
};

describe('posts (S5): post_id written at insert time', () => {
  it('7→8 at t and 8→9 at t+8 min share one post; a change at t+11 min starts a new post (review focus 4)', async () => {
    const e = await mk(A, { title: 'X', rating: 7 });
    const a = await idOf(A);
    await env.DB.exec('DELETE FROM activity'); // start clean: 7 is the stored value
    await rateAt(a, e.id, 8, at(0));
    await rateAt(a, e.id, 9, at(8));
    await rateAt(a, e.id, 10, at(11));
    const r = await rows(e.id);
    expect(r).toHaveLength(3);
    expect(r[0]!.post_id).toBeNull(); // the anchor
    expect(postOf(r[1]!)).toBe(r[0]!.id);
    expect(r[2]!.post_id).toBeNull(); // 11 min after the anchor: a new post, though only 3 min after the last change
    const page = await feed(A);
    const byPost = new Map<string, unknown[]>();
    for (const i of page.items) byPost.set(i.postId, [...(byPost.get(i.postId) ?? []), i.payload]);
    expect(byPost.get(r[0]!.id)).toEqual([{ from: 8, to: 9 }, { from: 7, to: 8 }]);
    expect(byPost.get(r[2]!.id)).toEqual([{ from: 9, to: 10 }]);
  });

  it('a reaction on the first post stays on it when a later change joins the post', async () => {
    const e = await mk(A, { title: 'X', rating: 7 });
    const a = await idOf(A);
    await env.DB.exec('DELETE FROM activity');
    await rateAt(a, e.id, 8, at(0));
    const [anchor] = await rows(e.id);
    await env.DB.prepare("INSERT INTO reactions (id, activity_id, user_id, emoji, created_at) VALUES ('r1', ?, ?, '🔥', ?)").bind(anchor!.id, a, at(1)).run();
    await rateAt(a, e.id, 9, at(8));
    const page = await feed(A);
    expect(new Set(page.items.map((i) => i.postId))).toEqual(new Set([anchor!.id]));
    expect(page.social[anchor!.id]).toEqual({ reactions: { '🔥': 1 }, mine: ['🔥'], comments: 0 });
  });

  it('a rating+status PATCH makes two rows in one post (the second statement sees the first as its anchor)', async () => {
    const e = await mk(A, { title: 'X', status: 'Watching / In Progress' });
    await env.DB.exec('DELETE FROM activity'); // so the PATCH's first row is the anchor
    await patch(A, e.id, { rating: 7, status: 'Completed' });
    const r = await rows(e.id);
    expect(r).toHaveLength(2);
    expect(r.filter((x) => x.post_id === null)).toHaveLength(1);
    expect(new Set(r.map(postOf)).size).toBe(1);
  });

  it('a change right after create joins the added post', async () => {
    const e = await mk(A, { title: 'X' });
    await patch(A, e.id, { rating: 7 });
    const r = await rows(e.id);
    expect(r.map((x) => x.type)).toEqual(['added', 'rated']);
    expect(postOf(r[1]!)).toBe(r[0]!.id);
  });
});

describe('GET /api/activity?show= (S6)', () => {
  const titles = (p: ActivityPage) => [...new Set(p.items.map((i) => i.title))].sort();

  it("friend B sees A's posts on everyone and friends, not on you; A's posts carry A's public user", async () => {
    await befriend(A, B);
    await mk(A, { title: 'Frieren', rating: 9 });
    await mk(B, { title: 'Mine', rating: 5 });
    expect(titles(await feed(B, '?show=everyone'))).toEqual(['Frieren', 'Mine']);
    expect(titles(await feed(B, ''))).toEqual(['Frieren', 'Mine']); // default is everyone
    expect(titles(await feed(B, '?show=friends'))).toEqual(['Frieren']);
    expect(titles(await feed(B, '?show=you'))).toEqual(['Mine']);
    const page = await feed(B, '?show=friends');
    const a = await idOf(A);
    expect(page.items[0]!.userId).toBe(a);
    expect(page.users[a]).toEqual({ id: a, username: '', displayName: null, avatarAt: null });
    expect(JSON.stringify(page)).not.toContain('a@example.com');
  });

  it("B never sees A's private-entry posts; turning an entry private hides its existing posts at once (review focus 1)", async () => {
    await befriend(A, B);
    await mk(A, { title: 'Secret', rating: 8, isPrivate: true });
    const open = await mk(A, { title: 'Open', rating: 8 });
    expect(titles(await feed(B, '?show=friends'))).toEqual(['Open']);
    await patch(A, open.id, { isPrivate: true });
    expect((await feed(B, '?show=friends')).items).toEqual([]);
    expect((await feed(B, '?show=everyone')).items).toEqual([]);
    expect(titles(await feed(A))).toEqual(['Open', 'Secret']); // the owner still sees both
  });

  it('pending C sees A on Everyone (all active users) but not Friends; unfriending cuts Friends at once, not Everyone', async () => {
    await befriend(A, B);
    await befriend(C, A, 'pending');
    await mk(A, { title: 'Frieren', rating: 9 });
    expect(titles(await feed(C, '?show=everyone'))).toEqual(['Frieren']);
    expect((await feed(C, '?show=friends')).items).toEqual([]);
    expect((await feed(C, '?show=everyone')).friends).toEqual([]);
    await env.DB.exec('DELETE FROM friendships');
    expect((await feed(B, '?show=friends')).items).toEqual([]);
    expect(titles(await feed(B, '?show=everyone'))).toEqual(['Frieren']);
  });

  it('A\'s bare "added" post (no rating, no status) is hidden from B, shown to A on You', async () => {
    await befriend(A, B);
    await mk(A, { title: 'Bare' });
    await mk(A, { title: 'Rated', rating: 7 });
    await mk(A, { title: 'Marked', status: 'Completed' });
    expect(titles(await feed(B, '?show=friends'))).toEqual(['Marked', 'Rated']);
    expect(titles(await feed(B, '?show=everyone'))).toEqual(['Marked', 'Rated']);
    expect(titles(await feed(A, '?show=you'))).toEqual(['Bare', 'Marked', 'Rated']);
  });

  it('a bare added post that later gets a rating in the same post shows to friends', async () => {
    await befriend(A, B);
    const e = await mk(A, { title: 'Later' });
    expect((await feed(B, '?show=friends')).items).toEqual([]);
    await patch(A, e.id, { rating: 8 });
    const page = await feed(B, '?show=friends');
    expect(page.items.map((i) => i.type).sort()).toEqual(['added', 'rated']);
  });

  it("Everyone shows non-friends' posts (not on Friends), the page marks who is a friend (Dan 2026-11-16)", async () => {
    await befriend(A, B);
    await mk(A, { title: 'FriendPost', rating: 9 });
    await mk(C, { title: 'StrangerPost', rating: 8 });
    await mk(B, { title: 'Mine', rating: 5 });
    const page = await feed(B, '?show=everyone');
    expect(titles(page)).toEqual(['FriendPost', 'Mine', 'StrangerPost']);
    expect(page.friends).toEqual([await idOf(A)]);
    expect(titles(await feed(B, '?show=friends'))).toEqual(['FriendPost']);
    expect(titles(await feed(B, '?show=you'))).toEqual(['Mine']);
  });

  it("a stranger's private entry, bare added, pending and removed users never appear on Everyone", async () => {
    await mk(C, { title: 'Secret', rating: 8, isPrivate: true });
    await mk(C, { title: 'Bare' });
    await mk(C, { title: 'Visible', rating: 7 });
    const d = 'd@example.com';
    await mk(d, { title: 'FromRemoved', rating: 7 });
    const e = 'e@example.com';
    await mk(e, { title: 'FromPending', rating: 7 });
    await mk(B, { title: 'Own private', rating: 6, isPrivate: true });
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE email = ?").bind(d).run();
    await env.DB.prepare("UPDATE users SET status = 'pending' WHERE email = ?").bind(e).run();
    expect(titles(await feed(B, '?show=everyone'))).toEqual(['Own private', 'Visible']);
    // A stranger turning an entry private hides it from Everyone at once.
    const vis = await env.DB.prepare("SELECT id FROM entries WHERE title = 'Visible'").first<{ id: string }>();
    await patch(C, vis!.id, { isPrivate: true });
    expect(titles(await feed(B, '?show=everyone'))).toEqual(['Own private']);
  });

  it('unread stays friends-only: a stranger\'s post does not count', async () => {
    await mk(C, { title: 'StrangerPost', rating: 8 });
    await idOf(B);
    const res = await as(B, '/api/activity/unread');
    expect(((await res.json()) as { feed: number }).feed).toBe(0);
  });

  it('an unknown show is a 400', async () => {
    expect((await as(A, '/api/activity?show=all')).status).toBe(400);
  });

  it('social carries reaction counts, mine and comment counts (deleted comments left out)', async () => {
    await befriend(A, B);
    const e = await mk(A, { title: 'Frieren', rating: 9 });
    const [anchor] = await rows(e.id);
    const a = await idOf(A);
    const b = await idOf(B);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reactions (id, activity_id, user_id, emoji, created_at) VALUES ('r1', ?1, ?2, '❤️', ?3), ('r2', ?1, ?4, '❤️', ?3), ('r3', ?1, ?4, '🔥', ?3)")
        .bind(anchor!.id, a, at(1), b),
      env.DB.prepare("INSERT INTO comments (id, activity_id, user_id, body, created_at, deleted_at) VALUES ('c1', ?1, ?2, 'nice', ?3, NULL), ('c2', ?1, ?2, 'gone', ?3, ?3)")
        .bind(anchor!.id, b, at(2)),
    ]);
    const forB = await feed(B, '?show=friends');
    expect(forB.social[anchor!.id]).toEqual({ reactions: { '❤️': 2, '🔥': 1 }, mine: ['❤️', '🔥'], comments: 1 });
    const forA = await feed(A);
    expect(forA.social[anchor!.id]).toEqual({ reactions: { '❤️': 2, '🔥': 1 }, mine: ['❤️'], comments: 1 });
  });

  it('a page with posts from 2 users, reactions and comments costs ≤ 10 queries', async () => {
    await befriend(A, B);
    for (let i = 0; i < 5; i++) await mk(A, { title: `A${i}`, rating: 7 });
    for (let i = 0; i < 5; i++) await mk(B, { title: `B${i}`, rating: 7 });
    const post = (await env.DB.prepare('SELECT id FROM activity LIMIT 1').first<{ id: string }>())!.id;
    await env.DB.prepare("INSERT INTO comments (id, activity_id, user_id, body, created_at) VALUES ('c1', ?, ?, 'x', ?)").bind(post, await idOf(B), at(0)).run();
    const spy = spyD1(env.DB);
    const res = await app.fetch(new Request('https://app.test/api/activity?show=everyone'),
      { ...env, DB: spy.db, ENVIRONMENT: 'dev', DEV_EMAIL: B } as Env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ActivityPage).items).toHaveLength(10);
    expect(spy.queries).toBeLessThanOrEqual(10);
    expect(spy.maxParams).toBeLessThanOrEqual(100);
  });
});

describe('unread (S8)', () => {
  const unread = async (email: string, db?: D1Database) => {
    const res = await app.fetch(new Request('https://app.test/api/activity/unread'),
      { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env);
    expect(res.status).toBe(200);
    return (await res.json()) as { feed: number; requests: number };
  };

  it("counts B's new posts and others' comments and reactions for A, then 0 after seen; A's own don't count", async () => {
    await befriend(A, B);
    const mine = await mk(A, { title: 'Mine', rating: 6 });
    expect((await as(A, '/api/activity/seen', 'POST')).status).toBe(204);
    expect(await unread(A)).toEqual({ feed: 0, requests: 0, messages: 0 });

    // Push the seen time back so the writes below are clearly newer.
    await env.DB.prepare('UPDATE users SET feed_seen_at = ? WHERE email = ?').bind('2000-01-01T00:00:00.000Z', A).run();
    await env.DB.exec('DELETE FROM activity');
    await mk(B, { title: 'Theirs', rating: 9 });
    await mk(B, { title: 'Bare' }); // bare added: not a post others see
    await mk(B, { title: 'Hidden', rating: 9, isPrivate: true });
    const a = await idOf(A);
    const b = await idOf(B);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO comments (id, entry_id, user_id, body, created_at) VALUES ('c1', ?1, ?2, 'mine', ?3), ('c2', ?1, ?4, 'theirs', ?3)")
        .bind(mine.id, a, at(0), b),
      env.DB.prepare("INSERT INTO reactions (id, entry_id, user_id, emoji, created_at) VALUES ('r1', ?1, ?2, '🔥', ?3), ('r2', ?1, ?4, '🔥', ?3)")
        .bind(mine.id, a, at(0), b),
    ]);
    expect(await unread(A)).toEqual({ feed: 3, requests: 0, messages: 0 }); // Theirs + B's comment + B's reaction

    expect((await as(A, '/api/activity/seen', 'POST')).status).toBe(204);
    const seen = await env.DB.prepare('SELECT feed_seen_at FROM users WHERE email = ?').bind(A).first<{ feed_seen_at: string }>();
    expect(seen!.feed_seen_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    // at(0) may lie after the real clock's "now": move those rows before the seen time.
    await env.DB.exec('UPDATE comments SET created_at = \'2001-01-01T00:00:00.000Z\'; UPDATE reactions SET created_at = \'2001-01-01T00:00:00.000Z\';');
    expect(await unread(A)).toEqual({ feed: 0, requests: 0, messages: 0 });
  });

  it('requests counts incoming pending only; feed caps at 99; 1 query plus sign-in', async () => {
    await befriend(A, B);
    await befriend(C, A, 'pending');
    await idOf(A);
    const b = await idOf(B);
    const e = await mk(B, { title: 'X', rating: 5 });
    await env.DB.exec('DELETE FROM activity');
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 120; i++) {
      stmts.push(env.DB.prepare(
        `INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES (?, ?, ?, 'rated', '{}', ?, ?)`,
      ).bind(`u${i}`, b, e.id, at(i * 20), at(i * 20)));
    }
    for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
    const spy = spyD1(env.DB);
    expect(await unread(A, spy.db)).toEqual({ feed: 99, requests: 1, messages: 0 });
    expect(spy.queries).toBeLessThanOrEqual(4);
    expect(await unread(C)).toEqual({ feed: 0, requests: 0, messages: 0 }); // C's own request is outgoing
  });
});


describe('deleting your own posts', () => {
  const count = async (sql: string, ...v: unknown[]) => (await env.DB.prepare(sql).bind(...v).first<{ n: number }>())!.n;
  const post = async (title: string) => {
    const e = await mk(A, { title, rating: 7 });
    await patch(A, e.id, { status: 'Completed' });
    const [anchor] = await rows(e.id);
    return { e, anchor: anchor!.id };
  };

  it('DELETE /api/activity/:postId removes the anchor, its joined rows, reactions and comments; the entry stays', async () => {
    await befriend(A, B);
    const p = await post('Gone');
    const keep = await post('Keep');
    const a = await idOf(A);
    const b = await idOf(B);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reactions (id, activity_id, user_id, emoji, created_at) VALUES ('r1', ?1, ?2, '❤️', ?3), ('r2', ?4, ?2, '❤️', ?3)").bind(p.anchor, b, at(1), keep.anchor),
      env.DB.prepare("INSERT INTO comments (id, activity_id, user_id, body, created_at) VALUES ('c1', ?1, ?2, 'x', ?3), ('c2', ?4, ?2, 'y', ?3)").bind(p.anchor, b, at(1), keep.anchor),
    ]);
    expect((await rows(p.e.id)).length).toBeGreaterThan(1);
    const res = await as(A, `/api/activity/${p.anchor}`, 'DELETE');
    expect(res.status).toBe(204);
    expect(await rows(p.e.id)).toEqual([]);
    expect(await count('SELECT COUNT(*) AS n FROM reactions WHERE activity_id = ?', p.anchor)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE activity_id = ?', p.anchor)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM reactions')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM comments')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM entries WHERE id = ?', p.e.id)).toBe(1);
    expect(titles2(await feed(A))).toEqual(['Keep']);
    expect(titles2(await feed(B, '?show=friends'))).toEqual(['Keep']);
    void a;
  });

  it("404 for someone else's post, a missing id, and a non-anchor row; nothing is deleted", async () => {
    const p = await post('Mine');
    expect((await as(B, `/api/activity/${p.anchor}`, 'DELETE')).status).toBe(404);
    expect((await as(A, '/api/activity/nope', 'DELETE')).status).toBe(404);
    const child = await env.DB.prepare('SELECT id FROM activity WHERE post_id = ?').bind(p.anchor).first<{ id: string }>();
    expect((await as(A, `/api/activity/${child!.id}`, 'DELETE')).status).toBe(404);
    expect((await rows(p.e.id)).length).toBe(2);
  });

  it('a friend cannot delete your post either, and the call costs one batch', async () => {
    await befriend(A, B);
    const p = await post('Mine');
    expect((await as(B, `/api/activity/${p.anchor}`, 'DELETE')).status).toBe(404);
    const spy = spyD1(env.DB);
    const res = await app.fetch(new Request(`https://app.test/api/activity/${p.anchor}`, { method: 'DELETE' }),
      { ...env, DB: spy.db, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env);
    expect(res.status).toBe(204);
    expect(spy.queries).toBeLessThanOrEqual(8);
  });

  it('POST /api/activity/delete removes many of your posts in one batch and ignores ids that are not yours', async () => {
    const p1 = await post('One');
    const p2 = await post('Two');
    const p3 = await post('Three');
    const other = await mk(B, { title: 'Theirs', rating: 5 });
    const [theirs] = await rows(other.id);
    const spy = spyD1(env.DB);
    const res = await app.fetch(new Request('https://app.test/api/activity/delete', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postIds: [p1.anchor, p2.anchor, theirs!.id, 'nope'] }),
    }), { ...env, DB: spy.db, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(spy.queries).toBeLessThanOrEqual(8);
    expect(spy.maxParams).toBeLessThanOrEqual(100);
    expect(titles2(await feed(A))).toEqual(['Three']);
    expect(titles2(await feed(B))).toEqual(['Theirs']);
    void p3;
  });

  it('POST /api/activity/delete validates: 1 to 100 string ids', async () => {
    const send = (body: unknown) => as(A, '/api/activity/delete', 'POST', body);
    expect((await send({ postIds: [] })).status).toBe(400);
    expect((await send({})).status).toBe(400);
    expect((await send({ postIds: [1] })).status).toBe(400);
    expect((await send({ postIds: Array.from({ length: 101 }, (_, i) => `p${i}`) })).status).toBe(400);
    expect((await send({ postIds: Array.from({ length: 100 }, (_, i) => `p${i}`) })).status).toBe(200);
  });

  it('requires sign-in', async () => {
    const res = await app.fetch(new Request('https://app.test/api/activity/x', { method: 'DELETE' }), { ...env, ENVIRONMENT: 'prod' } as Env);
    expect(res.status).toBe(401);
  });
});
const titles2 = (p: ActivityPage) => [...new Set(p.items.map((i) => i.title))].sort();
