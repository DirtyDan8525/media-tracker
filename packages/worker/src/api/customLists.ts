/**
 * Custom lists (Phase 7, migration 0020), mounted at /api/lists. Only the owner reads or writes them here; friends and
 * public links see them through the routes that show that person's titles (friends.ts, public.ts, activity.ts).
 *
 * A list's titles are entries rows with category `c_<id>`; its rating set is that key. The signed-in user's lists come
 * with the sign-in row (auth/user.ts CUSTOM_LISTS_SQL), so checks against them cost no query.
 */
import { Hono } from 'hono';
import {
  CUSTOM_LISTS_MAX, customKey, isCustomCategory, mergePatch, validateCustomList,
  type CustomList, type CustomListInput, type UserSettings,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { featureOn } from '../settings/appSettings';
import { customListsSql, parseLists } from '../lists/sql';

export const customLists = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
/** 409 when a seventh list is asked for. */
export const LIMIT_MESSAGE = `You can have up to ${CUSTOM_LISTS_MAX} custom lists. Delete one to make another.`;

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** 10 random [a-z0-9]: short and URL-safe (the key is `c_<id>`). */
export function newListId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** camelCase field -> column; booleans stored 0/1, '' icon stored NULL. */
const COLUMNS: Record<keyof CustomListInput, string> = {
  name: 'name', noun: 'noun', icon: 'icon', creatorLabel: 'creator_label', hasStatus: 'has_status', statusWords: 'status_words',
  showTags: 'show_tags', showYear: 'show_year', showGenres: 'show_genres', showProgress: 'show_progress', showLink: 'show_link',
  searchSource: 'search_source',
};
const dbValue = (k: keyof CustomListInput, v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : k === 'icon' && v === '' ? null : v);

/** The person's lists, fresh (after a write). */
async function listsOf(db: D1Database, userId: string): Promise<CustomList[]> {
  const row = await db.prepare(`SELECT ${customListsSql('?1')}`).bind(userId).first<{ custom_lists_json: string | null }>();
  return parseLists(row?.custom_lists_json);
}

// 0 queries (+ sign-in): they came with it.
customLists.get('/', (c) => c.json({ lists: c.var.user.customLists, max: CUSTOM_LISTS_MAX }));

// 1 (feature switch, cached) + 2 queries (+ sign-in): the insert, guarded by the count in the same statement, then the lists.
customLists.post('/', featureOn('customLists'), async (c) => {
  const v = validateCustomList(await readJson(c.req.raw), 'create');
  if (!v.ok) return c.json({ error: 'invalid', field: v.error }, 400);
  const userId = c.var.user.id;
  if (c.var.user.customLists.length >= CUSTOM_LISTS_MAX) return c.json({ error: 'limit', max: CUSTOM_LISTS_MAX, message: LIMIT_MESSAGE }, 409);
  const value = v.value as CustomListInput;
  const id = newListId();
  const keys = Object.keys(COLUMNS) as (keyof CustomListInput)[];
  const cols = ['id', 'user_id', ...keys.map((k) => COLUMNS[k]), 'created_at'];
  // The count check rides in the INSERT, so two tabs racing can't pass the limit.
  const res = await c.env.DB.prepare(
    `INSERT INTO custom_lists (${cols.join(', ')}) SELECT ${cols.map(() => '?').join(', ')}
      WHERE (SELECT COUNT(*) FROM custom_lists WHERE user_id = ?) < ${CUSTOM_LISTS_MAX}`,
  ).bind(id, userId, ...keys.map((k) => dbValue(k, value[k])), new Date().toISOString(), userId).run();
  if (!res.meta.changes) return c.json({ error: 'limit', max: CUSTOM_LISTS_MAX, message: LIMIT_MESSAGE }, 409);
  const lists = await listsOf(c.env.DB, userId);
  return c.json({ list: lists.find((l) => l.id === id), lists }, 201);
});

// 2 queries (+ sign-in): the update, then the lists. Works with the feature switch off: existing lists keep working.
customLists.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.var.user.id;
  if (!c.var.user.customLists.some((l) => l.id === id)) return c.json(notFound, 404);
  const v = validateCustomList(await readJson(c.req.raw), 'patch');
  if (!v.ok) return c.json({ error: 'invalid', field: v.error }, 400);
  const keys = Object.keys(v.value) as (keyof CustomListInput)[];
  if (keys.length > 0) {
    await c.env.DB.prepare(`UPDATE custom_lists SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...keys.map((k) => dbValue(k, v.value[k])), id, userId)
      .run();
  }
  const lists = await listsOf(c.env.DB, userId);
  const list = lists.find((l) => l.id === id);
  return list ? c.json({ list, lists }) : c.json(notFound, 404);
});

/** The stored settings without any trace of `key` (its switch, tiers, place in the order, and its `customized` mark). */
export function settingsWithout(stored: UserSettings, customized: Record<string, unknown>, key: string): Record<string, unknown> {
  const tabs = { ...stored.tabs };
  delete tabs[key];
  const tiers = { ...stored.tiers } as Record<string, unknown>;
  delete tiers[key];
  const nextCustomized = mergePatch(customized, { tabs: { [key]: null } }) as Record<string, unknown>;
  if (nextCustomized.tabs && typeof nextCustomized.tabs === 'object' && Object.keys(nextCustomized.tabs).length === 0) delete nextCustomized.tabs;
  return { ...stored, tabs, tiers, listOrder: stored.listOrder.filter((c) => c !== key), customized: nextCustomized };
}

// 1 batch (+ sign-in): the list's titles (their seasons, tags, posts, comments and reactions go by ON DELETE CASCADE),
// its comparisons, the list, and the settings that named it. The app asks the person to type the list's name first.
customLists.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.var.user;
  const key = customKey(id);
  if (!isCustomCategory(key) || !user.customLists.some((l) => l.id === id)) return c.json(notFound, 404);
  const db = c.env.DB;
  const settings = settingsWithout(user.storedSettings, user.customized, key);
  const res = await db.batch([
    db.prepare('DELETE FROM entries WHERE user_id = ? AND category = ?').bind(user.id, key),
    db.prepare('DELETE FROM comparisons WHERE user_id = ? AND category = ?').bind(user.id, key),
    db.prepare('DELETE FROM custom_lists WHERE id = ? AND user_id = ?').bind(id, user.id),
    db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').bind(JSON.stringify(settings), user.id),
  ]);
  if (!res[2]!.meta.changes) return c.json(notFound, 404);
  return c.json({ lists: user.customLists.filter((l) => l.id !== id) });
});

