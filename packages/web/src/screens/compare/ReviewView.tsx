import { formatRating, type RatingSession } from '@media-tracker/shared';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Button } from '../../design/components/Button';
import { CountUp } from '../../design/components/CountUp';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';

/**
 * One changed title (old → new, with tiers). The ratings module's `RatingChange`; the top-level
 * name is still the Sheet engine's until Task 12 deletes it, so it is taken from the session.
 */
export type RatingChange = ReturnType<RatingSession['changes']>[number];

export interface ReviewViewProps {
  changes: RatingChange[];
  canBack: boolean;
  hasNext: boolean;
  /** The session has picks or moves to keep even though no shown score changed. */
  hasPicks: boolean;
  /** Tier names, indexed by tier. */
  tierNames: readonly string[];
  /** Cover for a change's row, when the title is known. */
  coverOf?(id: string): { src: string; square: boolean } | undefined;
  /** The save still conflicted after its retry: the set changed elsewhere. */
  conflict?: boolean;
  onReload?(): void;
  onBack(): void;
  onSave(): void;
  onDontSave(): void;
  onNext(): void;
}

export const CONFLICT_TEXT = 'Your ratings changed elsewhere. Reload and try again.';

/** Moves focus to a view's heading when it appears, so screen readers announce it. */
export function useFocusHeading<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

/** "Liked → Loved", or just the tier for a title that had none. */
function tierLine(c: RatingChange, names: readonly string[]): string | null {
  if (c.oldTier === c.tier) return null;
  return c.oldTier === null ? names[c.tier]! : `${names[c.oldTier]} → ${names[c.tier]}`;
}

/** The session's new ratings as old → new (nothing saved until Save), or "All good" when no score changes. */
export function ReviewView({
  changes, canBack, hasNext, hasPicks, tierNames, coverOf, conflict, onReload, onBack, onSave, onDontSave, onNext,
}: ReviewViewProps) {
  const heading = useFocusHeading<HTMLHeadingElement>();
  const back = canBack && <Button onClick={onBack}>← Back to last pick</Button>;
  const alert = conflict && (
    <div role="alert" className="compare__alert">
      <span>{CONFLICT_TEXT}</span>
      <Button compact onClick={onReload}>Reload</Button>
    </div>
  );

  if (!changes.length) {
    return (
      <div className="compare-review">
        <div className="compare__head">
          <h1 ref={heading} tabIndex={-1} className="compare__title">All good</h1>
          <span className="compare__sub">
            {hasPicks
              ? 'Your picks keep every score as it is. Save them so the order stays settled.'
              : 'Your ratings already match your picks. Nothing changes.'}
          </span>
        </div>
        {alert}
        <div className="compare__end-actions">
          {hasPicks
            ? (
              <>
                <Button variant="primary" className="btn--block" onClick={onSave}>Save picks</Button>
                <div className="compare__end-pair">{back}<Button onClick={onDontSave}>Don't save</Button></div>
              </>
            )
            : (
              <>
                <Button variant="primary" className="btn--block" onClick={onNext}>{hasNext ? 'Next' : 'Close'}</Button>
                {back}
              </>
            )}
        </div>
      </div>
    );
  }

  return (
    <div className="compare-review">
      <div className="compare__head">
        <h1 ref={heading} tabIndex={-1} className="compare__title">New ratings</h1>
        <span className="compare__sub">Based on your picks. Nothing is saved until you press Save.</span>
      </div>
      <ul aria-label="Rating changes" className="rev">
        {changes.map((c, i) => {
          const up = c.old === null || c.rating > c.old;
          const cover = coverOf?.(c.id);
          const tiers = tierLine(c, tierNames);
          return (
            <li key={c.id} className="rev__row rise-in" style={{ '--i': Math.min(i, 12) } as CSSProperties}>
              <span className="rev__cover" aria-hidden="true">
                <CoverImage src={cover?.src} alt={`${c.title} cover`} square={cover?.square} width={32} className="cover--sm" />
              </span>
              <span className="rev__text">
                <span className="rev__title" data-role="title">{c.title}</span>
                {tiers && <span className="rev__tiers" data-role="tiers">{tiers}</span>}
              </span>
              <span className="rev__old" data-role="old">{c.old === null ? '—' : formatRating(c.old)}</span>
              <span className="rev__arrow" aria-hidden="true">→</span>
              <span className="rev__new" data-role="new">
                <span className={up ? 'rev__dir rev__dir--up' : 'rev__dir rev__dir--down'} aria-hidden="true">{up ? '▲' : '▼'}</span>
                <RatingBadge rating={c.rating} size="sm">
                  <CountUp value={c.rating} from={c.old ?? c.rating} />
                </RatingBadge>
                <span className="sr-only">{up ? ' up' : ' down'}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {alert}
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
