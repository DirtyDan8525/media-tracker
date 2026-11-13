import { CATEGORY_CONFIG, type Entry } from '@media-tracker/shared';
import { Link } from 'react-router';
import { effectiveLookupState } from '../../data/entryCache';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';
import { Skeleton } from '../../design/components/Skeleton';
import { StatusPill } from '../../design/components/StatusPill';
import { LookupNote } from './LookupNote';

export interface RowActions {
  onRetry: (e: Entry) => void;
  onPaste: (e: Entry) => void;
}

/** Phone list: one card per entry. */
export function EntryCards({ rows, label, ...actions }: { rows: Entry[]; label: string } & RowActions) {
  return (
    <ul className="stack-10 plain-list" aria-label={label}>
      {rows.map((e) => <EntryCard key={e.id} entry={e} {...actions} />)}
    </ul>
  );
}

function EntryCard({ entry: e, ...actions }: { entry: Entry } & RowActions) {
  const square = CATEGORY_CONFIG[e.category].square;
  const state = effectiveLookupState(e);
  const meta = [e.creator, e.genres].filter(Boolean).join(' · ');

  if (state === 'pending') {
    return (
      <li className="entry-card entry-card--pending">
        <Skeleton width={52} height={square ? 52 : 78} radius={8} />
        <div className="entry-card__text">
          <span className="entry-card__title" data-role="title">{e.title}</span>
          <LookupNote entry={e} {...actions} />
        </div>
      </li>
    );
  }
  if (state === 'not_found') {
    return (
      <li className="entry-card">
        <CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={square} />
        <div className="entry-card__text">
          <Link className="entry-card__title" data-role="title" to={`/entry/${e.id}`}>{e.title}</Link>
          <LookupNote entry={e} {...actions} />
        </div>
        <RatingBadge rating={e.rating} />
      </li>
    );
  }
  return (
    <li className="entry-card entry-card--ok">
      <Link className="entry-card__link" to={`/entry/${e.id}`}>
        <CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={square} />
        <div className="entry-card__text">
          <span className="entry-card__title" data-role="title">{e.title}</span>
          {meta && <span className="entry-card__meta">{meta}</span>}
          {e.status && <StatusPill status={e.status} />}
        </div>
        <RatingBadge rating={e.rating} />
      </Link>
    </li>
  );
}
