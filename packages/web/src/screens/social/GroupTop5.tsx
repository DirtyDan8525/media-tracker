import { CATEGORY_CONFIG, formatRating, groupTop5, type Category, type GroupRow } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { useFriendsEntries, useFriends } from '../../data/social';
import { useAllEntries } from '../../data/useEntries';
import { CoverImage } from '../../design/components/CoverImage';
import { EmptyState } from '../../design/components/EmptyState';
import { Skeleton } from '../../design/components/Skeleton';
import { enabledLists, LIST_LABEL } from '../../nav';
import { PageHeader } from '../../shell/PageHeader';
import { useAddFriend } from '../../shell/AddFriendHost';
import { useSessionMe } from '../../shell/SessionGate';
import '../../design/ratings.css';

/** Top 5's "Friends" view: you and every friend together, per list. A title counts once at least 2 people rated it. */
export function GroupTop5({ toggle }: { toggle: ReactNode }) {
  const me = useSessionMe();
  const qc = useQueryClient();
  const addFriend = useAddFriend();
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  const mine = useAllEntries(lists);
  const theirs = useFriendsEntries();
  const friends = useFriends();
  const header = <PageHeader title="Top 5" backTo="/profile" backUsesHistory profile sub="You and your friends, together.">{toggle}</PageHeader>;

  if (theirs.isError || friends.isError) {
    return (
      <div className="screen">
        {header}
        <div className="screen__body">
          <EmptyState icon="info" title="Couldn't load your friends' lists" body="Check your connection and try again."
            actionLabel="Retry" onAction={() => void qc.refetchQueries({ queryKey: ['social'] })} />
        </div>
      </div>
    );
  }
  if (theirs.isPending || friends.isPending || (mine.isPending && lists.some((c) => !mine.data[c]))) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        {header}
        <div className="screen__body stack-10"><Skeleton height={56} /><Skeleton height={56} /><Skeleton height={56} /></div>
      </div>
    );
  }
  if (friends.data.friends.length === 0) {
    return (
      <div className="screen">
        {header}
        <div className="screen__body">
          <EmptyState icon="user" title="No friends yet" body="Add a friend, then rate some of the same titles to see a group Top 5."
            actionLabel="Add friend" onAction={addFriend} />
        </div>
      </div>
    );
  }
  return (
    <div className="screen">
      {header}
      <div className="screen__body top5">
        {lists.length === 0 && <EmptyState icon="info" title="No lists are turned on" body="Turn a list on in Settings to see its Top 5." />}
        {lists.map((c) => {
          const rows = groupTop5([
            { userId: me.id, entries: mine.data[c] ?? [] },
            ...theirs.data.map((f) => ({ userId: f.userId, entries: f.entries.filter((e) => e.category === c) })),
          ]);
          return <GroupBlock key={c} category={c} rows={rows} />;
        })}
      </div>
    </div>
  );
}

function GroupBlock({ category, rows }: { category: Category; rows: GroupRow[] }) {
  const name = LIST_LABEL[category];
  const id = `group5-${category}`;
  const square = CATEGORY_CONFIG[category].square;
  return (
    <section aria-labelledby={id} className="top5__block">
      <h2 id={id} className="top5__heading">{name}</h2>
      {rows.length === 0 ? (
        <div className="top5__empty"><p>Rate more together to build a group Top 5 for {name}. A title shows once 2 of you have rated it.</p></div>
      ) : (
        <ol className="top5__list">
          {rows.map((r, i) => (
            <li key={r.title} className="top5__item" data-square={square || undefined}>
              <div className="top5__row">
                <span className="top5__rank">{i + 1}</span>{' '}
                <span className="top5__cover-wrap" aria-hidden="true">
                  <CoverImage src={r.coverUrl} alt={`${r.title} cover`} square={square} width={32} className="top5__cover" />
                </span>
                <span className="top5__text">
                  <span className="top5__title">{r.title}</span>{' '}
                  <span className="top5__creator">{formatRating(Math.round(r.average * 10) / 10)} · {r.raters} ratings</span>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
