import { CATEGORY_CONFIG, bothRated, formatRating, theirsNotYours, type Category, type FriendEntry, type PublicUser } from '@media-tracker/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAddToMine, type AddToMineResult } from '../../data/social';
import { useEntries } from '../../data/useEntries';
import { Button } from '../../design/components/Button';
import { CoverImage } from '../../design/components/CoverImage';
import { EmptyState } from '../../design/components/EmptyState';
import { RatingBadge } from '../../design/components/RatingBadge';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { LIST_LABEL } from '../../nav';
import { who } from './parts';
import '../../design/social.css';

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Compare with a friend (CompareFriend.wf) for one category: titles you both rated, biggest gap first,
 * then their best titles you don't have. Your side is your own list, private titles included on the
 * device and dropped by the shared functions.
 */
export function CompareWithFriend({ user, category, entries }: { user: PublicUser; category: Category; entries: FriendEntry[] }) {
  const mine = useEntries(category);
  const addToMine = useAddToMine();
  const toast = useToast();
  const [done, setDone] = useState<Record<string, AddToMineResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const name = who(user);
  const label = LIST_LABEL[category];
  const theirs = useMemo(() => entries.filter((e) => e.category === category), [entries, category]);
  const both = useMemo(() => (mine.data ? bothRated(mine.data, theirs) : []), [mine.data, theirs]);
  // A title you just added stays in the list (as "On your list") instead of vanishing under your finger.
  const added = useMemo(() => new Set(Object.values(done).filter((r) => !r.duplicate).map((r) => r.entryId)), [done]);
  const missing = useMemo(() => {
    if (!mine.data) return [];
    const byId = new Map(theirs.map((e) => [e.id, e]));
    return theirsNotYours(mine.data.filter((m) => !added.has(m.id)), theirs).flatMap((c) => byId.get(c.id) ?? []);
  }, [mine.data, theirs, added]);

  if (mine.isPending) return <div className="stack-10" aria-busy="true" aria-label="Loading"><Skeleton height={64} /><Skeleton height={64} /></div>;
  if (mine.isError || !mine.data) {
    return <EmptyState icon="info" title={`Couldn't load your ${label} list`} body="Check your connection and try again." actionLabel="Retry" onAction={() => void mine.refetch()} />;
  }
  const square = CATEGORY_CONFIG[category].square;

  async function add(e: FriendEntry) {
    setBusy(e.id);
    try {
      const r = await addToMine(e);
      setDone((d) => ({ ...d, [e.id]: r }));
      if (!r.duplicate) toast.show(`Added ${e.title} to your list`);
    } catch {
      toast.show("Couldn't add it. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section aria-labelledby="cmp-both" className="group">
        <h2 id="cmp-both" className="group__title">Both rated</h2>
        {both.length === 0 ? (
          <p className="friend-note">Nothing you've both rated in {label} yet.</p>
        ) : (
          <ul className="people plain-list">
            {both.map((r) => (
              <li key={`${r.myId}-${r.theirId}`}>
                <Link to={`/entry/${r.myId}`} className="person" aria-label={`${r.title}: You ${formatRating(r.mine)}, ${name} ${formatRating(r.theirs)}`}>
                  <span aria-hidden="true"><CoverImage src={r.coverUrl} alt="" square={square} width={40} /></span>
                  <span className="person__meta">
                    <span className="person__name">{r.title}</span>
                    <span className="person__sub">{r.diff === 0 ? 'Same rating' : `Differ by ${formatRating(round(r.diff))}`}</span>
                  </span>
                  <span className="cmp-scores" aria-hidden="true">
                    You <RatingBadge rating={r.mine} size="xs" /> · {name} <RatingBadge rating={r.theirs} size="xs" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="cmp-theirs" className="group">
        <h2 id="cmp-theirs" className="group__title">Theirs, not yours</h2>
        {missing.length === 0 ? (
          <p className="friend-note">Nothing from {name} to add in {label} right now.</p>
        ) : (
          <ul className="people plain-list">
            {missing.map((e) => {
              const r = done[e.id];
              return (
                <li key={e.id} className="person">
                  <Link to={`/u/${user.username}/entry/${e.id}`} className="person__meta" style={{ textDecoration: 'none' }}
                    aria-label={`${e.title}, ${name} rated ${e.rating === null ? 'nothing' : formatRating(e.rating)}`}>
                    <span className="person__name">{e.title}</span>
                    <span className="person__sub">{name} rated</span>
                  </Link>
                  <RatingBadge rating={e.rating} size="xs" />
                  {r ? (
                    <Link to={`/entry/${r.entryId}`} className="btn btn--secondary btn--compact">{r.duplicate ? 'Already on your list' : 'On your list'}</Link>
                  ) : (
                    <Button compact aria-label={`Add ${e.title} to mine`} disabled={busy === e.id} onClick={() => void add(e)}>Add to mine</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
