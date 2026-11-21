/**
 * D1 rows-read budget for the hot read paths (free plan: 5M rows read a day). Seeds a realistic
 * dataset (10 friends, 300 titles each, 2,000 activity rows, 10 chats x 500 messages, comparisons,
 * seasons, tags, reactions, comments) and sums D1's own `meta.rows_read` over every statement each
 * request runs, through the production sign-in path (session cookie, not DEV_EMAIL).
 *
 * Each budget is the number measured after migration 0019 and the query fixes (2026-11-20) plus about half again:
 * a change that brings back a full scan or a whole-chat sort fails here. Before the fixes, for comparison: /api/me
 * 944, unread 9,188-10,349, chat list 5,288, chat page poll 2,498, recommended 5,023, Everyone feed 5,260.
 * PERF=rows prints the table (as the failure message) and PERF=plan adds EXPLAIN QUERY PLAN for every statement.
 */
import { env } from 'cloudflare:workers';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { sha256Hex } from '../src/auth/session';

const USERS = 10;
const ENTRIES_PER_USER = 300;
const ACTIVITY_ROWS = 2_000;
const MESSAGES_PER_CHAT = 500;
const REPORT = env.PERF === 'rows' || env.PERF === 'plan';
const PLAN = env.PERF === 'plan';

interface Meter { db: D1Database; rows: number; queries: number; stmts: { sql: string; values: unknown[]; rows: number }[]; reset(): void }

/** Wraps D1 and sums meta.rows_read of every statement (first() and raw() are answered from all(), which carries meta). */
function meterD1(real: D1Database): Meter {
  const m: Meter = {
    db: undefined as unknown as D1Database, rows: 0, queries: 0, stmts: [],
    reset() { m.rows = 0; m.queries = 0; m.stmts = []; },
  };
  const note = (sql: string, values: unknown[], meta: { rows_read?: number } | undefined) => {
    const r = meta?.rows_read ?? 0;
    m.rows += r;
    m.queries++;
    m.stmts.push({ sql, values, rows: r });
  };
  type Wrapped = D1PreparedStatement & { __inner: D1PreparedStatement; __sql: string; __values: unknown[] };
  const wrap = (stmt: D1PreparedStatement, sql: string, values: unknown[]): D1PreparedStatement => {
    const w = {
      __inner: stmt, __sql: sql, __values: values,
      bind: (...v: unknown[]) => wrap(stmt.bind(...v), sql, v),
      all: async () => { const r = await stmt.all(); note(sql, values, r.meta); return r; },
      run: async () => { const r = await stmt.run(); note(sql, values, r.meta); return r; },
      first: async (col?: string) => {
        const r = await stmt.all<Record<string, unknown>>();
        note(sql, values, r.meta);
        const row = r.results[0] ?? null;
        return col === undefined ? row : row === null ? null : (row[col] ?? null);
      },
      raw: async (opts?: { columnNames?: boolean }) => {
        const r = await stmt.all<Record<string, unknown>>();
        note(sql, values, r.meta);
        const rows = r.results.map((o) => Object.values(o));
        return opts?.columnNames ? [Object.keys(r.results[0] ?? {}), ...rows] : rows;
      },
    };
    return w as unknown as D1PreparedStatement;
  };
  m.db = new Proxy(real, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql, []);
      if (prop === 'batch') {
        return async (stmts: D1PreparedStatement[]) => {
          const res = await target.batch(stmts.map((s) => (s as Wrapped).__inner ?? s));
          res.forEach((r, i) => note((stmts[i] as Wrapped).__sql ?? '(batch)', (stmts[i] as Wrapped).__values ?? [], r.meta));
          return res;
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return m;
}

const tokens: string[] = [];
const ids = Array.from({ length: USERS }, (_, i) => `u${i}`);
let meter: Meter;

const ts = (minutesExpr: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', '2026-01-01', '+' || (${minutesExpr}) || ' minutes')`;

async function seed(db: D1Database) {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 365 * 86_400_000).toISOString();
  for (let i = 0; i < USERS; i++) {
    const token = `tok${String(i).padStart(2, '0')}`.padEnd(43, 'x');
    tokens.push(token);
    await db.batch([
      db.prepare(`INSERT INTO users (id, email, username, display_name, settings_json, is_admin, created_at, status, invite_code) VALUES (?, ?, ?, ?, '{}', ?, ?, 'active', ?)`)
        .bind(ids[i], `user${i}@x.test`, `user${i}`, `User ${i}`, i === 0 ? 1 : 0, now, `INV${i}`),
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)')
        .bind(await sha256Hex(token), ids[i], now, later, now),
    ]);
  }
  // Everyone is friends with everyone (45 pairs).
  await db.prepare(`INSERT INTO friendships (user_a, user_b, status, requested_by, created_at, accepted_at)
    SELECT a.id, b.id, 'accepted', a.id, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z' FROM users a JOIN users b ON a.id < b.id`).run();
  const cats = `json_array('anime','movies','tv','albums','songs','games','books','manga')`;
  await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${ENTRIES_PER_USER - 1})
    INSERT INTO entries (id, user_id, category, title, status, rating, typed, created_at, updated_at, is_private, notes)
    SELECT 'e' || u.id || '_' || n.i, u.id, json_extract(${cats}, '$[' || (n.i % 8) || ']'), 'Title ' || n.i,
           CASE WHEN n.i % 10 = 0 THEN 'Plan to watch' ELSE 'Completed' END,
           CASE WHEN n.i % 10 = 0 THEN NULL ELSE (n.i % 100) / 10.0 END, CASE WHEN n.i % 10 = 0 THEN NULL ELSE (n.i % 100) / 10.0 END,
           ${ts('n.i * 60')}, ${ts('n.i * 60')}, CASE WHEN n.i % 25 = 0 THEN 1 ELSE 0 END, 'a note'
      FROM users u, n`).run();
  // Two rated seasons on 20 anime titles each.
  await db.prepare(`INSERT INTO seasons (id, entry_id, label, rating, typed, created_at)
    SELECT 's' || e.id || '_' || k.k, e.id, 'Season ' || k.k, 7.5, 7.5, e.created_at FROM entries e, (SELECT 1 AS k UNION ALL SELECT 2) k
     WHERE e.category = 'anime' AND CAST(substr(e.id, instr(e.id, '_') + 1) AS INTEGER) < 160`).run();
  // 2,000 activity rows: 1,600 anchors (rated), 400 joined to an anchor.
  await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${ACTIVITY_ROWS * 4 / 5 - 1})
    INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at)
    SELECT 'a' || n.i, 'u' || (n.i % ${USERS}), 'eu' || (n.i % ${USERS}) || '_' || ((n.i / ${USERS}) % ${ENTRIES_PER_USER}), 'rated',
           json_object('from', NULL, 'to', 7), ${ts('n.i * 30')}, ${ts('n.i * 30')} FROM n`).run();
  await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${ACTIVITY_ROWS / 5 - 1})
    INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at, post_id)
    SELECT 'j' || n.i, a.user_id, a.entry_id, 'status', json_object('from', 'Watching', 'to', 'Completed'), a.created_at, a.created_at, a.id
      FROM n JOIN activity a ON a.id = 'a' || (n.i * 4)`).run();
  // Reactions and comments on posts' titles (they are the title's, migration 0025).
  await db.prepare(`INSERT INTO reactions (id, entry_id, user_id, emoji, created_at)
    SELECT 'r' || a.id || u.id, a.entry_id, u.id, '❤️', a.created_at FROM activity a JOIN users u ON u.id <> a.user_id
     WHERE a.post_id IS NULL AND CAST(substr(a.id, 2) AS INTEGER) % 50 = 0`).run();
  await db.prepare(`INSERT INTO comments (id, entry_id, user_id, body, created_at)
    SELECT 'c' || a.id, a.entry_id, 'u' || ((CAST(substr(a.id, 2) AS INTEGER) + 1) % ${USERS}), 'nice', a.created_at FROM activity a
     WHERE a.post_id IS NULL AND CAST(substr(a.id, 2) AS INTEGER) % 16 = 0`).run();
  // 200 comparisons a person in anime; 10 tags each on 10 titles.
  await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 199)
    INSERT INTO comparisons (id, user_id, category, winner_id, loser_id, created_at)
    SELECT 'k' || u.id || '_' || n.i, u.id, 'anime', 'e' || u.id || '_' || ((n.i * 8) % 296), 'e' || u.id || '_' || ((n.i * 8 + 8) % 296), ${ts('n.i')}
      FROM users u, n`).run();
  await db.prepare(`INSERT INTO tags (id, user_id, name, created_at) SELECT 't' || u.id || '_' || k.k, u.id, 'tag' || k.k, '2026-01-01'
    FROM users u, (WITH RECURSIVE k(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM k WHERE k < 9) SELECT k FROM k) k`).run();
  await db.prepare(`INSERT INTO entry_tags (entry_id, tag_id) SELECT 'e' || t.user_id || '_' || (CAST(substr(t.id, instr(t.id, '_') + 1) AS INTEGER) * 3), t.id FROM tags t`).run();
  // 9 direct chats (u0 with each friend) and one group of everyone, 500 messages each, all read.
  const convs: { id: string; members: string[] }[] = [];
  for (let k = 1; k < USERS; k++) convs.push({ id: `cd${k}`, members: ['u0', `u${k}`] });
  convs.push({ id: 'cg', members: ids });
  for (const c of convs) {
    const direct = c.members.length === 2;
    await db.batch([
      db.prepare(`INSERT INTO conversations (id, kind, name, created_by, created_at, last_message_at, direct_key) VALUES (?, ?, ?, 'u0', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)`)
        .bind(c.id, direct ? 'direct' : 'group', direct ? null : 'Everyone', direct ? [...c.members].sort().join(':') : null),
      db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, joined_at) SELECT ?1, value, '2026-01-01T00:00:00.000Z' FROM json_each(?2)`)
        .bind(c.id, JSON.stringify(c.members)),
      db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${MESSAGES_PER_CHAT - 1})
        INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at, reply_to)
        SELECT ?1 || '_' || n.i, ?1, json_extract(?2, '$[' || (n.i % json_array_length(?2)) || ']'), CASE WHEN n.i % 40 = 0 THEN 'rec' ELSE 'text' END,
               'message ' || n.i, ${ts('n.i * 7')}, CASE WHEN n.i % 9 = 0 AND n.i > 0 THEN ?1 || '_' || (n.i - 1) END FROM n`)
        .bind(c.id, JSON.stringify(c.members)),
      db.prepare(`UPDATE conversations SET last_message_at = (SELECT MAX(created_at) FROM messages WHERE conversation_id = ?1) WHERE id = ?1`).bind(c.id),
      db.prepare(`UPDATE conversation_members SET last_read_at = (SELECT MAX(created_at) FROM messages WHERE conversation_id = ?1) WHERE conversation_id = ?1`).bind(c.id),
    ]);
  }
  // Message reactions on the group: two on every third message (about 330 rows); the direct chats have none.
  await db.prepare(`INSERT INTO message_reactions (message_id, conversation_id, user_id, emoji, created_at)
    SELECT m.id, m.conversation_id, u.id, '❤️', m.created_at FROM messages m JOIN (SELECT 'u1' AS id UNION ALL SELECT 'u2') u
     WHERE m.conversation_id = 'cg' AND CAST(substr(m.id, 4) AS INTEGER) % 3 = 0`).run();
  await db.prepare(`UPDATE conversations SET reaction_rev = 1 WHERE id = 'cg'`).run();
  await db.prepare(`UPDATE users SET feed_seen_at = '2026-01-30T00:00:00.000Z'`).run();
  await db.prepare(`INSERT INTO app_settings (key, value_json, updated_at) VALUES ('features', '{}', '2026-01-01'), ('announcement', '{"text":"hi"}', '2026-01-01')`).run();
}

const HOT: { name: string; path: string; budget: number; conditional?: true; prep?: string }[] = [
  { name: 'GET /api/me', path: '/api/me', budget: 10 },
  { name: 'GET /api/app', path: '/api/app', budget: 5 },
  { name: 'GET /api/activity/unread (99+ new)', path: '/api/activity/unread', budget: 700 },
  { name: 'GET /api/activity/unread (nothing new)', path: '/api/activity/unread', budget: 150,
    prep: "UPDATE users SET feed_seen_at = '2026-03-01T00:00:00.000Z' WHERE id = 'u0'" },
  { name: 'GET /api/conversations (30 s poll)', path: '/api/conversations', budget: 350 },
  { name: 'GET chat page (5 s poll, direct)', path: '/api/conversations/cd1/messages', budget: 220 },
  // The group carries message reactions (2 on every third message): about 4 rows per reaction on top of the page's ~140.
  { name: 'GET chat page (5 s poll, group, reactions)', path: '/api/conversations/cg/messages', budget: 450 },
  { name: 'GET chat page, idle poll (If-None-Match: 304)', path: '/api/conversations/cd1/messages', budget: 40, conditional: true },
  { name: 'GET group page, idle poll (If-None-Match: 304)', path: '/api/conversations/cg/messages', budget: 45, conditional: true },
  { name: 'GET group page, older (with reactions)', path: '/api/conversations/cg/messages?before=cg_200', budget: 450 },
  { name: 'GET /api/conversations/:id', path: '/api/conversations/cd1', budget: 40 },
  { name: 'GET /api/messages/recommended', path: '/api/messages/recommended', budget: 250 },
  { name: 'GET /api/activity?show=everyone', path: '/api/activity?show=everyone', budget: 900 },
  { name: 'GET /api/activity?show=friends', path: '/api/activity?show=friends', budget: 950 },
  { name: 'GET /api/activity?show=you', path: '/api/activity?show=you', budget: 1100 },
  { name: 'GET /api/entries', path: '/api/entries', budget: 1500 },
  { name: 'GET /api/entries?category=anime', path: '/api/entries?category=anime', budget: 300 },
  { name: 'GET /api/entries/:id', path: '/api/entries/eu0_7', budget: 10 },
  { name: 'GET /api/friends', path: '/api/friends', budget: 60 },
  { name: 'GET /api/friends/entries (full)', path: '/api/friends/entries', budget: 12000 },
  { name: 'GET /api/friends/entries?brief=1 (Top 5)', path: '/api/friends/entries?brief=1', budget: 7800 },
  { name: 'GET /api/friends/entries?category=anime', path: '/api/friends/entries?category=anime', budget: 2400 },
  { name: 'GET /api/users/user1', path: '/api/users/user1', budget: 15 },
  { name: 'GET /api/users/user1/entries?category=anime', path: '/api/users/user1/entries?category=anime', budget: 300 },
  { name: 'GET /api/users/search?q=us', path: '/api/users/search?q=us', budget: 30 },
  { name: 'GET /api/ratings/close-counts', path: '/api/ratings/close-counts', budget: 1800 },
  { name: 'GET /api/ratings/anime', path: '/api/ratings/anime', budget: 750 },
  { name: 'GET /api/tags', path: '/api/tags', budget: 80 },
  { name: 'GET /api/compare/queue', path: '/api/compare/queue', budget: 10 },
  { name: 'GET /api/reactions?entryId', path: '/api/reactions?entryId=eu0_7', budget: 30 },
  { name: 'GET /api/comments?activityId', path: '/api/comments?activityId=a0', budget: 20 },
];

async function hit(path: string, user = 0, headers: Record<string, string> = {}) {
  meter.reset();
  const res = await app.fetch(
    new Request(`https://app.test${path}`, { headers: { Cookie: `mt_session=${tokens[user]}`, ...headers } }),
    { ...env, DB: meter.db, ENVIRONMENT: 'dev', DEV_EMAIL: '' } as Env,
  );
  const body = await res.text();
  return { status: res.status, body, etag: res.headers.get('ETag'), rows: meter.rows, queries: meter.queries, stmts: [...meter.stmts] };
}

describe('rows read per hot request (seeded: 10 users x 300 titles, 10 chats x 500 messages)', () => {
  beforeAll(async () => {
    meter = meterD1(env.DB);
    await seed(env.DB);
  });
  afterAll(async () => {
    await env.DB.exec('DELETE FROM users');
    await env.DB.exec('DELETE FROM app_settings');
  });

  it('measures every hot endpoint', async () => {
    const lines: string[] = [];
    for (const h of HOT) {
      if (h.prep) await env.DB.prepare(h.prep).run();
      const warm = await hit(h.path); // warm (lazy backfills, per-isolate caches)
      const r = await hit(h.path, 0, h.conditional ? { 'If-None-Match': warm.etag ?? '' } : {});
      expect(r.status, `${h.name}: ${r.body.slice(0, 200)}`).toBe(h.conditional ? 304 : 200);
      lines.push(`${h.name.padEnd(48)} rows ${String(r.rows).padStart(6)}  queries ${r.queries}`);
      if (!REPORT) expect(r.rows, `${h.name}: rows read`).toBeLessThanOrEqual(h.budget);
      if (PLAN) {
        for (const s of r.stmts) {
          let plan = '';
          try {
            const p = await env.DB.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).bind(...s.values).all<{ detail: string }>();
            plan = p.results.map((x) => x.detail).join(' | ');
          } catch (e) {
            plan = `(no plan: ${String(e).slice(0, 80)})`;
          }
          lines.push(`    ${String(s.rows).padStart(6)}  ${s.sql.replace(/\s+/g, ' ').slice(0, 160)}\n            PLAN: ${plan}`);
        }
      }
    }
    // Report mode: the table is the failure message (console output from inside the Workers pool is not shown).
    if (REPORT) expect.fail(`\n${lines.join('\n')}\n`);
  });
});
