import { CATEGORY_CONFIG, formatRating, statusLabel, mergeActivity, type ActivityLine, type Status } from '@media-tracker/shared';
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useActivity } from '../data/useActivity';
import { Button } from '../design/components/Button';
import { CoverImage } from '../design/components/CoverImage';
import { EmptyState } from '../design/components/EmptyState';
import { SegRadio } from '../design/components/SegRadio';
import { SkeletonRow } from '../design/components/Skeleton';
import { useNow } from '../hooks';
import { LIST_LABEL } from '../nav';
import { useCurrentList } from '../shell/currentList';
import { useAddFriend } from '../shell/comingWithFriends';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { dayLabel, timeAgo, type ActivityFilter } from './activity/format';
import '../design/activity.css';

const FILTERS: readonly { value: ActivityFilter; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'you', label: 'You' },
];

const isFilter = (v: string | null): v is ActivityFilter => FILTERS.some((f) => f.value === v);

/** Activity (route /activity). Built for friends (Everyone / Friends / You); until Phase 4 only You has rows. */
export function ActivityScreen() {
  const me = useSessionMe();
  const current = useCurrentList();
  const addFriend = useAddFriend();
  const [params, setParams] = useSearchParams();
  const shown = params.get('show');
  const filter: ActivityFilter = isFilter(shown) ? shown : 'you';
  const setFilter = (v: ActivityFilter) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (v === 'you') p.delete('show');
      else p.set('show', v);
      return p;
    }, { replace: true });

  // Only You has data until Phase 4: the other two never ask the server.
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } =
    useActivity(filter === 'you');

  // B15 / review focus 4: merge over every loaded page at once, so edits that straddle a page
  // boundary still fold into one line.
  const lines = useMemo(() => mergeActivity(data?.pages.flatMap((p) => p.items) ?? []), [data]);
  const initial = (me.username ?? me.email).charAt(0).toUpperCase();
  // Ticks once a minute while the screen is visible, so "5 min ago" keeps up.
  const now = useNow();

  let body: ReactNode;
  if (filter !== 'you') {
    body = (
      <EmptyState icon="activity" title="Nothing here yet"
        body="Add friends to see what they rate and finish. Your own activity shows here too."
        actionLabel="Add friend" onAction={addFriend} />
    );
  } else if (isError && !data) {
    body = (
      <EmptyState icon="info" title="Couldn't load your activity" body="Check your connection and try again."
        actionLabel="Retry" onAction={() => void refetch()} />
    );
  } else if (isPending) {
    body = <div aria-busy="true" className="stack-10"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>;
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
              {d.lines.map((line) => <ActivityRow key={line.key} line={line} initial={initial} now={now} />)}
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
      <PageHeader title="Activity">
        <SegRadio block="activity-filter" label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      </PageHeader>
      <div className="screen__body">{body}</div>
    </div>
  );
}

function ActivityRow({ line, initial, now }: { line: ActivityLine; initial: string; now: Date }) {
  const title = (
    <Link className="activity-line__title" to={`/entry/${line.entryId}`}><strong>{line.title}</strong></Link>
  );
  const status = line.status ? statusLabel(line.status.to as Status, line.category) : null;
  let sentence: ReactNode;
  if (line.added) {
    sentence = (
      <>
        <strong>You</strong> added {title} to {LIST_LABEL[line.category]}
        {line.rating && ` · rated ${formatRating(line.rating.to)}`}
        {status && ` · marked ${status}`}
      </>
    );
  } else if (line.rating) {
    const { from, to } = line.rating;
    sentence = (
      <>
        <strong>You</strong> {from === null ? 'rated' : 're-rated'} {title}{' '}
        {from === null ? formatRating(to) : `${formatRating(from)} → ${formatRating(to)}`}
        {status && ` · marked ${status}`}
      </>
    );
  } else {
    sentence = <><strong>You</strong> marked {title} {status}</>;
  }
  return (
    <li className="activity-line">
      <span className="activity-line__avatar" aria-hidden="true">{initial}</span>
      <div className="activity-line__text">
        <span className="activity-line__sentence">{sentence}</span>
        <time className="activity-line__time" dateTime={line.at}>{timeAgo(line.at, now)}</time>
      </div>
      <span aria-hidden="true" className="activity-line__cover">
        <CoverImage src={line.coverUrl} alt={`${line.title} cover`} square={CATEGORY_CONFIG[line.category].square} width={40} />
      </span>
    </li>
  );
}
