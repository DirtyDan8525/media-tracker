import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Relation } from '@media-tracker/shared';
import { ENTRY_SELECT, rowToEntry, type EntryRow } from '../src/api/entries';
import { canEdit, canView, pair, relationOf, toFriendEntry, visibleEntrySql } from '../src/social/visibility';

const now = '2026-11-16T12:00:00.000Z';
const users = ['A', 'B', 'C', 'D'];

async function seed() {
  const stmts = users.map((u) =>
    env.DB.prepare('INSERT INTO users (id, email, username, settings_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(u, `${u}@x.com`, u.toLowerCase(), '{}', now));
  const fr = (a: string, b: string, status: string, by: string) => {
    const [x, y] = pair(a, b);
    return env.DB.prepare('INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(x, y, status, by, now);
  };
  const ent = (id: string, priv: number, notesPriv: number) =>
    env.DB.prepare(`INSERT INTO entries (id, user_id, category, title, notes, is_private, notes_private, rating, created_at, updated_at, strength, prior_mean, score_locked)
      VALUES (?, 'A', 'Anime', ?, ?, ?, ?, 8, ?, ?, 1.2, 1.1, 1)`).bind(id, id, `notes ${id}`, priv, notesPriv, now, now);
  await env.DB.batch([
    ...stmts,
    fr('A', 'B', 'accepted', 'A'),
    fr('A', 'C', 'pending', 'A'),
    ent('pub', 0, 0),
    ent('pubNotesPriv', 0, 1),
    ent('priv', 1, 0),
  ]);
}

const rows = async () => (await env.DB.prepare(`${ENTRY_SELECT} WHERE e.user_id = 'A' ORDER BY e.id`).all<EntryRow>()).results;

beforeEach(seed);
afterEach(async () => {
  await env.DB.exec('DELETE FROM entries; DELETE FROM friendships; DELETE FROM users;');
});

describe('visibility', () => {
  it('relationOf', async () => {
    expect(await relationOf(env.DB, 'A', 'A')).toBe('self');
    expect(await relationOf(env.DB, 'B', 'A')).toBe('friend');
    expect(await relationOf(env.DB, 'A', 'B')).toBe('friend');
    expect(await relationOf(env.DB, 'A', 'C')).toBe('pending_out');
    expect(await relationOf(env.DB, 'C', 'A')).toBe('pending_in');
    expect(await relationOf(env.DB, 'D', 'A')).toBe('none');
  });

  it('canView matrix and notes', async () => {
    const all = await rows();
    const seen = async (viewer: string) => {
      const rel = await relationOf(env.DB, viewer, 'A');
      return all.filter((r) => canView(rel, { isPrivate: r.is_private === 1 })).map((r) => r.id).sort();
    };
    expect(await seen('A')).toEqual(['priv', 'pub', 'pubNotesPriv']);
    expect(await seen('B')).toEqual(['pub', 'pubNotesPriv']);
    expect(await seen('C')).toEqual([]);
    expect(await seen('D')).toEqual([]);
    const byId = Object.fromEntries(all.map((r) => [r.id, r]));
    expect(toFriendEntry(byId.pubNotesPriv!, 'friend').notes).toBeNull();
    expect(toFriendEntry(byId.pub!, 'friend').notes).toBe('notes pub');
  });

  it('SQL agrees with canView', async () => {
    const all = await rows();
    for (const viewer of users) {
      const rel: Relation = await relationOf(env.DB, viewer, 'A');
      const expected = all.filter((r) => canView(rel, { isPrivate: r.is_private === 1 })).map((r) => r.id).sort();
      const { results } = await env.DB.prepare(`SELECT id FROM entries e WHERE e.user_id = ?2 AND ${visibleEntrySql('e', '?1')} ORDER BY id`)
        .bind(viewer, 'A').all<{ id: string }>();
      expect(results.map((r) => r.id), viewer).toEqual(expected);
    }
  });

  it('toFriendEntry drops private and pick-derived fields, throws for private rows', async () => {
    const all = await rows();
    const out = toFriendEntry(all.find((r) => r.id === 'pub')!, 'friend');
    for (const k of ['strength', 'priorMean', 'scoreLocked', 'notesPrivate', 'isPrivate', 'importId', 'typedTitle', 'lookupState', 'updatedAt']) {
      expect(out, k).not.toHaveProperty(k);
    }
    expect(Object.keys(rowToEntry(all[0]!))).toContain('strength'); // sanity: the owner shape has it
    expect(() => toFriendEntry(all.find((r) => r.id === 'priv')!, 'friend')).toThrow();
    expect(() => toFriendEntry(all.find((r) => r.id === 'pub')!, 'pending_in')).toThrow();
    expect(toFriendEntry(all.find((r) => r.id === 'priv')!, 'self').id).toBe('priv');
  });

  it('canEdit is owner only', () => {
    expect(canEdit('B', 'A')).toBe(false);
    expect(canEdit('A', 'A')).toBe(true);
  });
});
