import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// Migration 0025: reactions and comments move from posts to their titles. The test puts the tables back in their
// pre-0025 shape (0006 + 0019, without the foreign keys so rows of a post or title that is gone can be made), fills
// them, runs 0025's own statements, and checks the rows and the new shape.
const OLD_SHAPE = [
  'DROP TABLE reactions',
  'DROP TABLE comments',
  `CREATE TABLE reactions (
    id TEXT PRIMARY KEY, activity_id TEXT, entry_id TEXT, user_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK ((activity_id IS NULL) <> (entry_id IS NULL)))`,
  'CREATE UNIQUE INDEX idx_reactions_post ON reactions(activity_id, user_id, emoji) WHERE activity_id IS NOT NULL',
  'CREATE UNIQUE INDEX idx_reactions_entry ON reactions(entry_id, user_id, emoji) WHERE entry_id IS NOT NULL',
  'CREATE INDEX idx_reactions_created ON reactions(created_at)',
  `CREATE TABLE comments (
    id TEXT PRIMARY KEY, activity_id TEXT, entry_id TEXT, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
    CHECK ((activity_id IS NULL) <> (entry_id IS NULL)))`,
  'CREATE INDEX idx_comments_post ON comments(activity_id, created_at)',
  'CREATE INDEX idx_comments_entry ON comments(entry_id, created_at)',
  'CREATE INDEX idx_comments_created ON comments(created_at)',
];

const t = (s: number) => `2026-11-20T10:00:0${s}.000Z`;

async function run0025() {
  const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith('0025_'));
  expect(m).toBeDefined();
  await env.DB.batch(m!.queries.map((q) => env.DB.prepare(q)));
}

describe('migration 0025: reactions and comments on titles', () => {
  it('moves post rows to their titles, keeps the newest of a duplicate, drops orphans, and leaves entry_id only', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('uA', 'a@x', 'a', '{}', ?1), ('uB', 'b@x', 'b', '{}', ?1), ('uC', 'c@x', 'c', '{}', ?1)").bind(t(0)),
      env.DB.prepare("INSERT INTO entries (id, user_id, category, title, created_at, updated_at) VALUES ('e1', 'uA', 'songs', 'Song', ?1, ?1), ('e2', 'uA', 'songs', 'Other', ?1, ?1)").bind(t(0)),
      env.DB.prepare(`INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at, post_id) VALUES
        ('p1', 'uA', 'e1', 'rated', '{}', ?1, ?1, NULL), ('p2', 'uA', 'e1', 're-rated', '{}', ?1, ?1, NULL),
        ('p1j', 'uA', 'e1', 'status', '{}', ?1, ?1, 'p1'), ('p3', 'uA', 'e2', 'rated', '{}', ?1, ?1, NULL)`).bind(t(0)),
    ]);
    await env.DB.batch(OLD_SHAPE.map((q) => env.DB.prepare(q)));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO reactions (id, activity_id, entry_id, user_id, emoji, created_at) VALUES
        ('r1', 'p1', NULL, 'uB', '🔥', ?1),   -- uB's 🔥 three times on e1 (two posts and the page): the newest (r2) stays
        ('r2', NULL, 'e1', 'uB', '🔥', ?3),
        ('r3', 'p2', NULL, 'uB', '🔥', ?2),
        ('r4', 'p1', NULL, 'uB', '❤️', ?1),   -- another emoji by the same person: kept
        ('r5', 'p1', NULL, 'uC', '🔥', ?1),   -- the same emoji by someone else: kept
        ('r6', 'p3', NULL, 'uB', '🔥', ?1),   -- another title: kept, on e2
        ('r7', 'gone', NULL, 'uB', '👍', ?1), -- its post is gone
        ('r8', NULL, 'nope', 'uB', '👍', ?1), -- its title is gone
        ('r9', 'p1', NULL, 'uGone', '👍', ?1) -- its user is gone`).bind(t(1), t(2), t(3)),
      env.DB.prepare(`INSERT INTO comments (id, activity_id, entry_id, user_id, body, created_at, deleted_at) VALUES
        ('c1', 'p1', NULL, 'uB', 'one', ?1, NULL),
        ('c2', 'p2', NULL, 'uB', 'two', ?2, NULL),   -- the same person again on the same title: comments are many
        ('c3', NULL, 'e2', 'uC', 'page', ?1, NULL),
        ('c4', 'p3', NULL, 'uC', 'deleted', ?1, ?2), -- a deleted one stays deleted
        ('c5', 'gone', NULL, 'uB', 'x', ?1, NULL),
        ('c6', NULL, 'nope', 'uB', 'x', ?1, NULL)`).bind(t(1), t(2)),
    ]);

    await run0025();

    const reactions = (await env.DB.prepare('SELECT id, entry_id, user_id, emoji, created_at FROM reactions ORDER BY id').all()).results;
    expect(reactions).toEqual([
      { id: 'r2', entry_id: 'e1', user_id: 'uB', emoji: '🔥', created_at: t(3) },
      { id: 'r4', entry_id: 'e1', user_id: 'uB', emoji: '❤️', created_at: t(1) },
      { id: 'r5', entry_id: 'e1', user_id: 'uC', emoji: '🔥', created_at: t(1) },
      { id: 'r6', entry_id: 'e2', user_id: 'uB', emoji: '🔥', created_at: t(1) },
    ]);
    const comments = (await env.DB.prepare('SELECT id, entry_id, user_id, body, created_at, deleted_at FROM comments ORDER BY id').all()).results;
    expect(comments).toEqual([
      { id: 'c1', entry_id: 'e1', user_id: 'uB', body: 'one', created_at: t(1), deleted_at: null },
      { id: 'c2', entry_id: 'e1', user_id: 'uB', body: 'two', created_at: t(2), deleted_at: null },
      { id: 'c3', entry_id: 'e2', user_id: 'uC', body: 'page', created_at: t(1), deleted_at: null },
      { id: 'c4', entry_id: 'e2', user_id: 'uC', body: 'deleted', created_at: t(1), deleted_at: t(2) },
    ]);

    // The new shape: no activity_id, entry_id required, one row per person per emoji per title, and the read indexes.
    for (const table of ['reactions', 'comments']) {
      const cols = (await env.DB.prepare(`SELECT name, "notnull" AS nn FROM pragma_table_info('${table}')`).all<{ name: string; nn: number }>()).results;
      expect(cols.map((c) => c.name)).not.toContain('activity_id');
      expect(cols.find((c) => c.name === 'entry_id')!.nn).toBe(1);
      const fks = (await env.DB.prepare(`SELECT "table", "from", on_delete FROM pragma_foreign_key_list('${table}')`).all()).results;
      expect(fks).toContainEqual({ table: 'entries', from: 'entry_id', on_delete: 'CASCADE' });
      expect(fks).toContainEqual({ table: 'users', from: 'user_id', on_delete: 'CASCADE' });
    }
    const idx = async (table: string) => (await env.DB.prepare(`SELECT name, "unique" AS u FROM pragma_index_list('${table}') WHERE origin = 'c'`).all<{ name: string; u: number }>()).results;
    expect((await idx('reactions')).map((i) => [i.name, i.u]).sort()).toEqual([['idx_reactions_created', 0], ['idx_reactions_entry', 1]]);
    expect((await idx('comments')).map((i) => i.name).sort()).toEqual(['idx_comments_created', 'idx_comments_entry']);
    const cols = (await env.DB.prepare("SELECT name FROM pragma_index_info('idx_reactions_entry') ORDER BY seqno").all<{ name: string }>()).results;
    expect(cols.map((c) => c.name)).toEqual(['entry_id', 'user_id', 'emoji']);
    await expect(env.DB.prepare("INSERT INTO reactions (id, entry_id, user_id, emoji, created_at) VALUES ('dup', 'e1', 'uB', '🔥', ?)").bind(t(4)).run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO comments (id, user_id, body, created_at) VALUES ('none', 'uB', 'x', ?)").bind(t(4)).run()).rejects.toThrow();
    // Deleting a title still takes its reactions and comments with it.
    await env.DB.prepare("DELETE FROM entries WHERE id = 'e2'").run();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM reactions WHERE entry_id = 'e2'").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE entry_id = 'e2'").first<{ n: number }>())!.n).toBe(0);
  });
});
