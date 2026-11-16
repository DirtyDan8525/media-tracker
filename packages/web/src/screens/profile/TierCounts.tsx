import { DEFAULT_TIERS, tierFor, tiersFor, type Category, type Entry, type Tier, type UserSettings } from '@media-tracker/shared';
import { useMemo } from 'react';
import { useAllEntries } from '../../data/useEntries';
import { TIERS_TOP_FIRST } from '../../design/components/TierPicker';
import { enabledLists } from '../../nav';
import { useSessionMe } from '../../shell/SessionGate';

export interface TierCount { name: string; count: number }

/** A rated title's tier: the stored one, else the number placed by its own list's tiers. */
function tierOf(e: Entry, settings: UserSettings): Tier {
  return e.tier ?? tierFor(e.rating!, tiersFor(settings, e.category));
}

/**
 * Rated titles per tier over `lists`, highest tier first (B23). Names are the shared ones when every
 * list uses the same names, else the default names (lists can each have their own tiers).
 */
export function tierCounts(byCategory: Partial<Record<Category, Entry[]>>, lists: Category[], settings: UserSettings): TierCount[] {
  const counts = [0, 0, 0, 0];
  for (const c of lists) {
    for (const e of byCategory[c] ?? []) if (e.rating !== null) counts[tierOf(e, settings)]++;
  }
  const first = lists.length ? tiersFor(settings, lists[0]!).names : DEFAULT_TIERS.names;
  const shared = lists.every((c) => tiersFor(settings, c).names.every((n, i) => n === first[i]));
  const names = shared ? first : DEFAULT_TIERS.names;
  return TIERS_TOP_FIRST.map((t) => ({ name: names[t]!, count: counts[t]! }));
}

/** Segment colours, top tier first: the rating colours of the Compare and Stats screens. */
const FILL = [
  'var(--cf-high)',
  'color-mix(in srgb, var(--cf-high) 50%, var(--cf-mid))',
  'var(--cf-mid)',
  'var(--cf-low)',
];

/** Profile board: a small tier bar over one muted line, "Loved 14 · Liked 22 · Fine 8 · Didn't like 4". Nothing until a title is rated. */
export function TierCounts() {
  const me = useSessionMe();
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  const { data } = useAllEntries(lists);
  const counts = useMemo(() => tierCounts(data, lists, me.settings), [data, lists, me.settings]);
  if (counts.every((c) => c.count === 0)) return null;
  const line = counts.map((c) => `${c.name} ${c.count}`).join(' · ');
  return (
    <div className="profile__tiers">
      <div role="img" aria-label={line} className="profile__tier-bar">
        {counts.map((c, i) => c.count > 0 && <span key={c.name} style={{ flex: c.count, background: FILL[i] }} />)}
      </div>
      <p className="profile__tier-line">{line}</p>
    </div>
  );
}
