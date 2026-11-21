import { formatRating, groupTop5, type Category, type GroupRow } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { useFriendsEntries, useFriends } from '../../data/social';
import { useAllEntries } from '../../data/useEntries';
import { EmptyState } from '../../design/components/EmptyState';
import { Skeleton } from '../../design/components/Skeleton';
import { useEnabledBuiltinLists } from '../../shell/useLists';
import { PageHeader } from '../../shell/PageHeader';
import { useAddFriend } from '../../shell/AddFriendHost';
import { useSessionMe } from '../../shell/SessionGate';
import { TopRow } from '../Top5Screen';
import '../../design/ratings.css';
import { listLabel } from '../../lists/registry';

/** Top 5's "Friends" view: you and every friend together, per list. A title counts once at least 2 people rated it. */
export function GroupTop5({ toggle }: { toggle: ReactNode }) {
  const me = useSessionMe();
  const qc = useQueryClient();
  const addFriend = useAddFriend();
  // Built-in lists only: a custom list is one person's own, so there is no group list to rank (Phase 7).
  const lists = useEnabledBuiltinLists();
  const mine = useAllEntries(lists);
  const theirs = useFriendsEntries();
  const friends = useFriends();
  const header = <PageHeader title="Top 5" backTo="/profile" backUsesHistory profile sub="You and your friends, together. Built-in lists only: custom lists are each person's own.">{toggle}</PageHeader>;

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
  const usernames = new Map(friends.data.friends.map((f) => [f.id, f.username]));
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
          return <GroupBlock key={c} category={c} rows={rows} myId={me.id} usernames={usernames} />;
        })}
      </div>
    </div>
  );
}

/** Where a group row opens: your own entry if you rated it, else the entry of the friend who rated it highest. */
export function groupRowHref(r: GroupRow, myId: string, usernames: Map<string, string>): string | null {
  const mine = r.owners.find((o) => o.userId === myId);
  if (mine) return `/entry/${mine.entryId}`;
  for (const o of r.owners) {
    const u = usernames.get(o.userId);
    if (u) return `/u/${u}/entry/${o.entryId}`;
  }
  return null;
}

function GroupBlock({ category, rows, myId, usernames }: { category: Category; rows: GroupRow[]; myId: string; usernames: Map<string, string> }) {
  const name = listLabel(category);
  const id = `group5-${category}`;
  return (
    <section aria-labelledby={id} className="top5__block">
      <h2 id={id} className="top5__heading">{name}</h2>
      {rows.length === 0 ? (
        <div className="top5__empty"><p>Rate more together to build a group Top 5 for {name}. A title shows once 2 of you have rated it.</p></div>
      ) : (
        <ol className="top5__list">
          {rows.map((r, i) => (
            <TopRow key={r.title} rank={i + 1} to={groupRowHref(r, myId, usernames)} backLabel="Friends Top 5" label={`${r.title}, group average ${formatRating(Math.round(r.average * 10) / 10)} from ${r.raters} ratings`} sub={`${r.raters} ratings`}
              entry={{ id: r.title, category, title: r.title, creator: '', coverUrl: r.coverUrl, rating: Math.round(r.average * 10) / 10 }} />
          ))}
        </ol>
      )}
    </section>
  );
}
