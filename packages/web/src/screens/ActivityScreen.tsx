import {
  CATEGORY_CONFIG, formatRating, nameOf, statusLabel, foldPosts, type ActivityLine, type PostSocial, type PublicUser, type Reaction, type Status,
} from '@media-tracker/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useFeed, useMarkSeen, useReact } from '../data/feed';
import { Button } from '../design/components/Button';
import { CoverImage } from '../design/components/CoverImage';
import { EmptyState } from '../design/components/EmptyState';
import { SegRadio } from '../design/components/SegRadio';
import { SkeletonRow } from '../design/components/Skeleton';
import { useNow } from '../hooks';
import { LIST_LABEL } from '../nav';
import { useCurrentList } from '../shell/currentList';
import { useAddFriend } from '../shell/AddFriendHost';
import { PageHeader } from '../shell/PageHeader';
import { CommentsSheet } from './social/CommentsSheet';
import { ReactionBar } from './social/ReactionBar';
import { useSessionMe } from '../shell/SessionGate';
import { dayLabel, timeAgo, type ActivityFilter } from './activity/format';
import '../design/activity.css';
import '../design/feed.css';

const FILTERS: readonly { value: ActivityFilter; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'you', label: 'You' },
];

const isFilter = (v: string | null): v is ActivityFilter => FILTERS.some((f) => f.value === v);

const NO_SOCIAL: PostSocial = { reactions: {}, mine: [], comments: 0 };

/** Activity (route /activity, S6): Everyone (default) / Friends / You; each post carries reactions and comments. */
export function ActivityScreen() {
  const me = useSessionMe();
  const current = useCurrentList();
  const addFriend = useAddFriend();
  const [params, setParams] = useSearchParams();
  const shown = params.get('show');
  const filter: ActivityFilter = isFilter(shown) ? shown : 'everyone';
  const setFilter = (v: ActivityFilter) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (v === 'everyone') p.delete('show');
      else p.set('show', v);
      return p;
    }, { replace: true });

  const { data, isPending, isError, isSuccess, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } =
    useFeed(filter);
  const [commenting, setCommenting] = useState<string | null>(null);

  // S8: Everyone and Friends count as seen once they have loaded.
  const markSeen = useMarkSeen();
  const seenFor = useRef<string | null>(null);
  useEffect(() => {
    if (filter === 'you' || !isSuccess || seenFor.current === filter) return;
    seenFor.current = filter;
    markSeen.mutate();
  }, [filter, isSuccess, markSeen]);

  // S5: the server groups rows into posts; fold over every loaded page at once.
  const lines = useMemo(() => foldPosts(data?.pages.flatMap((p) => p.items) ?? []), [data]);
  const users = useMemo(() => Object.assign({}, ...(data?.pages.map((p) => p.users) ?? [])) as Record<string, PublicUser>, [data]);
  const social = useMemo(() => Object.assign({}, ...(data?.pages.map((p) => p.social) ?? [])) as Record<string, PostSocial>, [data]);
  // Ticks once a minute while the screen is visible, so "5 min ago" keeps up.
  const now = useNow();

  let body: ReactNode;
  if (isError && !data) {
    body = (
      <EmptyState icon="info" title="Couldn't load your activity" body="Check your connection and try again."
        actionLabel="Retry" onAction={() => void refetch()} />
    );
  } else if (isPending) {
    body = <div aria-busy="true" className="stack-10"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>;
  } else if (lines.length === 0 && !hasNextPage && filter !== 'you') {
    body = (
      <EmptyState icon="activity" title="Nothing here yet" body="Add a friend to see what they rate."
        actionLabel="Add friend" onAction={addFriend} />
    );
  } else if (lines.length === 0 && !hasNextPage) {
    body = (
      <EmptyState icon="activity" title="Nothing here yet" body="Add or rate something and it shows up here."
        actionLabel={current ? `Open ${LIST_LABEL[current]}` : undefined}
        actionHref={current ? `/list/${current}` : undefined} />
    );
  } else {
    const days: { label: string; lines: ActivityLine[] }[] = [];
    for (const line of lines) {
      const label = dayLabel(line.at, now);
      const last = days[days.length - 1];
      if (last?.label === label) last.lines.push(line);
      else days.push({ label, lines: [line] });
    }
    body = (
      <div className="activity">
        {days.map((d, i) => (
          // The id is an index: a day label ("Sat, 13 Nov") has spaces, which an IDREF can't hold.
          <section key={d.label} aria-labelledby={`activity-day-${i}`} className="activity__day">
            <h2 id={`activity-day-${i}`} className="activity__day-title">{d.label}</h2>
            <ul className="stack-10 plain-list">
              {d.lines.map((line) => (
                <FeedPost key={line.key} line={line} now={now} social={social[line.key] ?? NO_SOCIAL}
                  who={line.userId === me.id ? null : users[line.userId] ?? { id: line.userId, username: 'friend', displayName: 'A friend', avatarAt: null }} onComments={() => setCommenting(line.key)} />
              ))}
            </ul>
          </section>
        ))}
        {isFetchNextPageError && (
          <div className="load-notice" role="status"><span>Couldn't load more.</span></div>
        )}
        {hasNextPage && (
          <Button variant="secondary" className="activity__more" disabled={isFetchingNextPage}
            aria-busy={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Show more
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <PageHeader title="Activity" profile>
        <SegRadio block="activity-filter" label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      </PageHeader>
      <div className="screen__body">{body}</div>
      {commenting && <CommentsSheet target={{ activityId: commenting }} open onClose={() => setCommenting(null)} />}
    </div>
  );
}

/** One post: the line, then reactions and the comment count under it. `who` is null for your own. */
function FeedPost({ line, now, social, who, onComments }: {
  line: ActivityLine; now: Date; social: PostSocial; who: PublicUser | null; onComments: () => void;
}) {
  const react = useReact();
  const target = { activityId: line.key } as const;
  const n = social.comments;
  return (
    <li className="feed-post">
      <ActivityRow line={line} now={now} who={who} />
      <div className="feed-post__social">
        <ReactionBar social={social} onToggle={(emoji: Reaction) => react.mutate({ target, emoji })} />
        <button type="button" className="feed-post__comments" onClick={onComments}>
          {n === 0 ? 'Comment' : n === 1 ? '1 comment' : `${n} comments`}
        </button>
      </div>
    </li>
  );
}

function PersonAvatar({ user }: { user: PublicUser }) {
  const [failed, setFailed] = useState(false);
  const initial = (user.displayName || user.username).charAt(0).toUpperCase();
  return (
    <span className="activity-line__avatar" aria-hidden="true">
      {user.avatarAt && !failed
        ? <img src={`/api/users/${encodeURIComponent(user.id)}/avatar?v=${encodeURIComponent(user.avatarAt)}`} alt="" width={40} height={40} decoding="async" onError={() => setFailed(true)} />
        : initial}
    </span>
  );
}

function ActivityRow({ line, now, who }: { line: ActivityLine; now: Date; who: PublicUser | null }) {
  const me = useSessionMe();
  const own = who === null;
  const title = (
    <Link className="activity-line__title" to={own ? `/entry/${line.entryId}` : `/u/${who.username}/entry/${line.entryId}`}>
      <strong>{line.title}</strong>
    </Link>
  );
  const name = own ? <strong>You</strong> : <Link className="activity-line__name" to={`/u/${who.username}`}>{nameOf(who)}</Link>;
  const status = line.status ? statusLabel(line.status.to as Status, line.category) : null;
  let sentence: ReactNode;
  if (line.added) {
    sentence = (
      <>
        {name} added {title} to {LIST_LABEL[line.category]}
        {line.rating && ` · rated ${formatRating(line.rating.to)}`}
        {status && ` · marked ${status}`}
      </>
    );
  } else if (line.rating) {
    const { from, to } = line.rating;
    sentence = (
      <>
        {name} {from === null ? 'rated' : 're-rated'} {title}{' '}
        {from === null ? formatRating(to) : `${formatRating(from)} → ${formatRating(to)}`}
        {status && ` · marked ${status}`}
      </>
    );
  } else {
    sentence = <>{name} marked {title} {status}</>;
  }
  return (
    <div className="activity-line">
      {own
        ? <span className="activity-line__avatar" aria-hidden="true">{(me.username ?? me.email).charAt(0).toUpperCase()}</span>
        : <PersonAvatar user={who} />}
      <div className="activity-line__text">
        <span className="activity-line__sentence">{sentence}</span>
        <time className="activity-line__time" dateTime={line.at}>{timeAgo(line.at, now)}</time>
      </div>
      <span aria-hidden="true" className="activity-line__cover">
        <CoverImage src={line.coverUrl} alt={`${line.title} cover`} square={CATEGORY_CONFIG[line.category].square} width={40} />
      </span>
    </div>
  );
}
