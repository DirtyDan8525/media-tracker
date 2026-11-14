import { formatRating, type RatingChange } from '@media-tracker/shared';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Button } from '../../design/components/Button';
import { CountUp } from '../../design/components/CountUp';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';

export interface ReviewViewProps {
  changes: RatingChange[];
  asked: number;
  canBack: boolean;
  hasNext: boolean;
  /** The compare style, as set ("Meet in the middle"). */
  style: string;
  /** Cover for a change's row, when the entry is known. */
  coverOf?(id: string): { src: string; square: boolean } | undefined;
  onBack(): void;
  onSave(): void;
  onDontSave(): void;
  onNext(): void;
}

/** Moves focus to a view's heading when it appears, so screen readers announce it. */
export function useFocusHeading<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

/** The new ratings a run worked out (nothing saved until Save), or "All good" when nothing changes. */
export function ReviewView({ changes, asked, canBack, hasNext, style, coverOf, onBack, onSave, onDontSave, onNext }: ReviewViewProps) {
  const heading = useFocusHeading<HTMLHeadingElement>();
  const back = canBack && <Button onClick={onBack}>← Back to last pick</Button>;

  if (!changes.length) {
    return (
      <div className="compare-review">
        <div className="compare__head">
          <h1 ref={heading} tabIndex={-1} className="compare__title">All good</h1>
          <span className="compare__sub">
            Your ratings already match your picks{asked ? '' : ' (nothing close enough to compare)'}. Nothing changes.
          </span>
        </div>
        <div className="compare__end-actions">
          <Button variant="primary" className="btn--block" onClick={onNext}>{hasNext ? 'Next' : 'Close'}</Button>
          {back}
        </div>
      </div>
    );
  }

  return (
    <div className="compare-review">
      <div className="compare__head">
        <h1 ref={heading} tabIndex={-1} className="compare__title">New ratings</h1>
        <span className="compare__sub">
          Based on your picks ({style.toLowerCase()}). Nothing is saved until you press Save.
        </span>
      </div>
      <ul aria-label="Rating changes" className="rev">
        {changes.map((c, i) => {
          const up = c.isNew || c.old === null || c.rating > c.old;
          const cover = coverOf?.(c.id);
          return (
            <li key={c.id} className="rev__row rise-in" style={{ '--i': Math.min(i, 12) } as CSSProperties}>
              <span className="rev__cover" aria-hidden="true">
                <CoverImage src={cover?.src} alt={`${c.title} cover`} square={cover?.square} width={32} className="cover--sm" />
              </span>
              <span className="rev__title" data-role="title">{c.title}</span>
              <span className="rev__old" data-role="old">{c.old === null ? '—' : formatRating(c.old)}</span>
              <span className="rev__arrow" aria-hidden="true">→</span>
              <span className="rev__new" data-role="new" aria-label={`${formatRating(c.rating)}, ${up ? 'up' : 'down'}`}>
                <span className={up ? 'rev__dir rev__dir--up' : 'rev__dir rev__dir--down'} aria-hidden="true">{up ? '▲' : '▼'}</span>
                <RatingBadge rating={c.rating} size="sm">
                  <CountUp value={c.rating} from={c.old ?? c.rating} />
                </RatingBadge>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="compare__end-actions">
        <Button variant="primary" className="btn--block" onClick={onSave}>Save new ratings</Button>
        <div className="compare__end-pair">
          {back}
          <Button onClick={onDontSave}>Don't save</Button>
        </div>
      </div>
    </div>
  );
}
