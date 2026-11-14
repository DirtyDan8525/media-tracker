import { CATEGORY_CONFIG, type Category, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { topFive } from '../ratings/topFive';
import { useAllEntries } from '../data/useEntries';
import { CoverBackdrop } from '../design/components/CoverBackdrop';
import { CoverImage } from '../design/components/CoverImage';
import { EmptyState } from '../design/components/EmptyState';
import { RatingBadge } from '../design/components/RatingBadge';
import { Skeleton } from '../design/components/Skeleton';
import { enabledLists, LIST_LABEL } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import '../design/ratings.css';

/** The five best-rated titles of every list that is turned on (route /top5). */
export function Top5Screen() {
  const me = useSessionMe();
  const qc = useQueryClient();
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  const { data, isPending, isError } = useAllEntries(lists);

  if (isError) {
    return (
      <div className="screen">
        <PageHeader title="Top 5" backTo="/more" />
        <div className="screen__body">
          <EmptyState icon="info" title="Couldn't load your lists" body="Check your connection and try again."
            actionLabel="Retry" onAction={() => void qc.refetchQueries({ queryKey: ['entries'] })} />
        </div>
      </div>
    );
  }
  if (isPending && lists.some((c) => !data[c])) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        <PageHeader title="Top 5" backTo="/more" />
        <div className="screen__body stack-10"><Skeleton height={144} /><Skeleton height={56} /><Skeleton height={56} /></div>
      </div>
    );
  }
  return (
    <div className="screen">
      <PageHeader title="Top 5" backTo="/more" sub="Your highest rated in each list." />
      <div className="screen__body top5">
        {lists.length === 0 && (
          <EmptyState icon="info" title="No lists are turned on" body="Turn a list on in Settings to see its Top 5." />
        )}
        {lists.map((c) => <TopBlock key={c} category={c} rows={data[c] ?? []} />)}
      </div>
    </div>
  );
}

function TopBlock({ category, rows }: { category: Category; rows: Entry[] }) {
  const name = LIST_LABEL[category];
  const top = useMemo(() => topFive(rows), [rows]);
  const id = `top5-${category}`;
  return (
    <section aria-labelledby={id} className="top5__block">
      <h2 id={id} className="top5__heading">{name}</h2>
      {top.length === 0 ? (
        <div className="top5__empty">
          <p>Nothing rated yet.</p>
          <Link to={`/list/${category}`} className="btn btn--secondary top5__go">Go to {name}</Link>
        </div>
      ) : (
        <ol className="top5__list">
          {top.map((e, i) => <TopRow key={e.id} entry={e} rank={i + 1} />)}
        </ol>
      )}
    </section>
  );
}

function TopRow({ entry, rank }: { entry: Entry; rank: number }) {
  const square = CATEGORY_CONFIG[entry.category].square;
  const hero = rank === 1;
  return (
    <li className={hero ? 'top5__item top5__item--hero' : 'top5__item'}>
      <Link to={`/entry/${entry.id}`} className={hero ? 'top5__hero' : 'top5__row'}>
        {hero && <CoverBackdrop src={entry.coverUrl} />}
        <span className="top5__rank">{rank}</span>{' '}
        {/* Decorative: the row's name is its text, so the cover stays out of the link's name. */}
        <span className="top5__cover-wrap" aria-hidden="true">
          <CoverImage src={entry.coverUrl} alt={`${entry.title} cover`} square={square} width={hero ? 96 : 32}
            className={hero ? 'top5__cover top5__cover--hero' : 'top5__cover'} />
        </span>
        <span className="top5__text">
          <span className={hero ? 'top5__title top5__title--hero' : 'top5__title'}>{entry.title}</span>{' '}
          {entry.creator && <span className="top5__creator">{entry.creator}</span>}
        </span>{' '}
        <RatingBadge rating={entry.rating} size={hero ? 'md' : 'sm'} />
      </Link>
    </li>
  );
}
