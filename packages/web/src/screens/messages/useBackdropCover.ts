import { type Category } from '@media-tracker/shared';
import { useRef, useState } from 'react';
import { useFriendEntries } from '../../data/social';
import { useAllEntries } from '../../data/useEntries';
import { topFive, type Ranked } from '../../ratings/topFive';
import { useEnabledLists } from '../../shell/useLists';

type Covered = Ranked & { category: Category; coverUrl: string | null };

/** The covers of each list's Top 5 (rated titles only), without repeats: the pool a Messages backdrop may draw from. */
export function topCovers(rows: Covered[]): string[] {
  const byList = new Map<Category, Covered[]>();
  for (const r of rows) byList.set(r.category, [...(byList.get(r.category) ?? []), r]);
  const out: string[] = [];
  for (const list of byList.values()) {
    for (const e of topFive(list)) if (e.coverUrl && !out.includes(e.coverUrl)) out.push(e.coverUrl);
  }
  return out;
}

/**
 * One cover for the blurred sides of the Messages screens, chosen once per visit (it stays put across renders and polls).
 * The pool is the viewer's own top titles plus, in a chat, one other member's (picked at random for a group) as far as
 * the server lets the viewer see them. Nothing is chosen until those lists have settled; null when there is no cover.
 */
export function useBackdropCover(otherUsernames: string[] = [], enabled = true): string | null {
  const lists = useEnabledLists();
  const mine = useAllEntries(enabled ? lists : []);
  const [member] = useState(() => otherUsernames[Math.floor(Math.random() * otherUsernames.length)] ?? null);
  const theirs = useFriendEntries(member ?? '', undefined, enabled && member !== null);
  const chosen = useRef<{ src: string | null } | null>(null);
  if (!enabled) return null;
  const settled = !mine.isPending && (member === null || !theirs.isPending);
  if (!chosen.current && settled) {
    const pool = [...topCovers(Object.values(mine.data).flat().filter((e): e is NonNullable<typeof e> => e !== undefined)), ...topCovers(theirs.data ?? [])].filter((s, i, all) => all.indexOf(s) === i);
    if (pool.length > 0) chosen.current = { src: pool[Math.floor(Math.random() * pool.length)]! };
  }
  return chosen.current?.src ?? null;
}
