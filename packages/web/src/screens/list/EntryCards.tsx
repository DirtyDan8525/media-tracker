import { CATEGORY_CONFIG, type Entry } from '@media-tracker/shared';
import type { CSSProperties } from 'react';
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
      {rows.map((e, i) => <EntryCard key={e.id} entry={e} index={i} {...actions} />)}
    </ul>
  );
}

/** Stagger index for the rise-in: only the first screenful staggers, the rest come in together. */
export const stagger = (i: number) => ({ '--i': Math.min(i, 10) }) as CSSProperties;

function EntryCard({ entry: e, index, ...actions }: { entry: Entry; index: number } & RowActions) {
  const square = CATEGORY_CONFIG[e.category].square;
  const state = effectiveLookupState(e);
  const meta = [e.creator, e.genres].filter(Boolean).join(' · ');

  if (state === 'pending') {
    return (
      <li className="entry-card entry-card--pending rise-in" style={stagger(index)}>
        <Skeleton width={56} height={square ? 56 : 84} radius={10} />
        <div className="entry-card__text">
          <span className="entry-card__title" data-role="title">{e.title}</span>
          <LookupNote entry={e} {...actions} />
        </div>
      </li>
    );
  }
  if (state === 'not_found') {
    return (
      <li className="entry-card rise-in" style={stagger(index)}>
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
    <li className="entry-card entry-card--ok rise-in" style={stagger(index)}>
      <Link className="entry-card__link" to={`/entry/${e.id}`}>
        <CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={square} />
        <div className="entry-card__text">
          <span className="entry-card__title" data-role="title">{e.title}</span>
          {meta && <span className="entry-card__meta">{meta}</span>}
          {e.status && <StatusPill status={e.status} />}
        </div>
        <RatingBadge rating={e.rating} className="settle" />
      </Link>
    </li>
  );
}
