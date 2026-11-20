/**
 * Custom lists (migration 0020) as SQL select-list items, so the lists ride along with a row the route already
 * reads (the signed-in user, a friend's header, a public profile, an activity row) instead of costing a query.
 * Reads go through idx_custom_lists_user (≤ 6 rows a person) or the primary key.
 */
import { customListOf, isBuiltinCategory, isCustomCategory, parseCustomListsJson, type Category, type CustomList } from '@media-tracker/shared';

const FIELDS = `json_object('id', cl.id, 'name', cl.name, 'noun', cl.noun, 'icon', cl.icon, 'creator_label', cl.creator_label,
  'has_status', cl.has_status, 'status_words', cl.status_words, 'show_tags', cl.show_tags, 'show_year', cl.show_year,
  'show_genres', cl.show_genres, 'show_progress', cl.show_progress, 'show_link', cl.show_link, 'search_source', cl.search_source,
  'created_at', cl.created_at)`;

/** `(…) AS <as>`: a JSON array of the custom lists of the user whose id is the SQL expression `userIdExpr`, oldest first. */
export function customListsSql(userIdExpr: string, as = 'custom_lists_json'): string {
  return `(SELECT json_group_array(${FIELDS}) FROM (SELECT * FROM custom_lists WHERE user_id = ${userIdExpr} ORDER BY created_at, id) cl) AS ${as}`;
}

/** `(…) AS <as>`: the custom list (JSON object) of an entries row aliased `alias`, or NULL for a built-in list. Primary-key read. */
export function entryListSql(alias: string, as = 'list_json'): string {
  return `CASE WHEN substr(${alias}.category, 1, 2) = 'c_' THEN (SELECT ${FIELDS} FROM custom_lists cl WHERE cl.id = substr(${alias}.category, 3)) END AS ${as}`;
}

export const parseLists = parseCustomListsJson;

/** One `list_json` object as a list, or null. */
export function parseList(json: string | null | undefined): CustomList | null {
  return json ? parseCustomListsJson(`[${json}]`)[0] ?? null : null;
}

/** True for a built-in key or the key of one of `lists` (the owner's custom lists). */
export function isListOf(category: unknown, lists: readonly CustomList[]): category is Category {
  return isBuiltinCategory(category) || (isCustomCategory(category) && customListOf(category, lists) !== undefined);
}
