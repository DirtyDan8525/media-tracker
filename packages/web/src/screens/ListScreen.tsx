import type { Category } from '@media-tracker/shared';
import { CATEGORY_CONFIG } from '@media-tracker/shared';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useEntries } from '../data/useEntries';
import { CoverImage } from '../design/components/CoverImage';
import { EmptyState } from '../design/components/EmptyState';
import { RatingBadge } from '../design/components/RatingBadge';
import { SkeletonRow } from '../design/components/Skeleton';
import { StatusPill } from '../design/components/StatusPill';
import { isCategory, LIST_LABEL } from '../nav';
import { PageHeader } from '../shell/PageHeader';

const NOUN: Record<Category, string> = {
  anime: 'anime', movies: 'movies', tv: 'TV shows', albums: 'albums', songs: 'songs', games: 'games', books: 'books',
};

/** Placeholder list (Task 13 builds the real one): header, loading rows, empty state, plain rows. */
export function ListScreen() {
  const { category } = useParams();
  if (!isCategory(category)) return <Navigate to="/" replace />;
  return <ListBody key={category} category={category} />;
}

function ListBody({ category }: { category: Category }) {
  const navigate = useNavigate();
  const { data, isPending, isError } = useEntries(category);
  const rows = data ?? [];
  const rated = rows.filter((e) => e.rating !== null).length;
  const sub = data ? `${rows.length} ${rows.length === 1 ? 'title' : 'titles'} · ${rated} rated` : undefined;
  return (
    <div className="screen">
      <PageHeader title={LIST_LABEL[category]} sub={sub} />
      <div className="screen__body list">
        {isPending && !data ? (
          <div aria-busy="true" aria-label={`Loading ${NOUN[category]}`} className="stack-10">
            <SkeletonRow /><SkeletonRow /><SkeletonRow />
          </div>
        ) : isError && !data ? (
          <EmptyState icon="info" title="Couldn't load this list" body="Check your connection and try again." />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={category}
            title={`No ${NOUN[category]} yet`}
            body="Titles you add or import will show up here."
            actionLabel="Import from Google Sheets"
            onAction={() => navigate('/import')}
          />
        ) : (
          <ul className="stack-10 plain-list">
            {rows.map((e) => (
              <li key={e.id} className="list-row">
                <CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={CATEGORY_CONFIG[category].square} />
                <div className="list-row__text">
                  <span className="list-row__title">{e.title}</span>
                  {e.creator && <span className="list-row__meta">{e.creator}{e.genres ? ` · ${e.genres}` : ''}</span>}
                  {e.status && <StatusPill status={e.status} />}
                </div>
                <RatingBadge rating={e.rating} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
