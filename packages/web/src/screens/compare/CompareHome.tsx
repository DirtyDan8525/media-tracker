import type { Category, RatingSet, Tier } from '@media-tracker/shared';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { Skeleton } from '../../design/components/Skeleton';
import { TIERS_TOP_FIRST } from '../../design/components/TierPicker';
import { LIST_LABEL } from '../../nav';
import { PageHeader } from '../../shell/PageHeader';

/** A list (or season tab) Fix my ratings is offered for; season tabs have no count until opened. */
export interface HomeList { set: RatingSet; label: string; icon: Category; count: number | null }
export interface ListCount { category: Category; count: number }

/** The chosen list's tier chips: counts once its set has loaded. */
export interface TierChips { names: readonly string[]; counts: readonly number[] | null; failed: boolean }

export interface CompareHomeProps {
  afterQueue: boolean;
  lists: HomeList[];
  unrated: ListCount[];
  onlyNew: boolean;
  chosen: RatingSet | null;
  tiers: TierChips | null;
  onList(set: RatingSet): void;
  onTier(t: Tier | null): void;
  onRetryTiers(): void;
  onUnrated(c: Category): void;
  /** Back from a run: focus goes to the heading so screen readers announce the home. */
  focusHeading?: boolean;
}

export const HOME_TITLE = 'Fix my ratings';
const ONLY_NEW = ' Settings → “Ask to compare” is set to only check new ratings.';
const PICK_A_LIST = 'Pick a list. The app asks about the two closest titles in a tier; stop any time.';

/** The Fix my ratings home: lists (2+ rated) and season tabs, then the chosen list's tiers; finished titles with no score by list. */
export function CompareHome({
  afterQueue, lists, unrated, onlyNew, chosen, tiers, onList, onTier, onRetryTiers, onUnrated, focusHeading,
}: CompareHomeProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusHeading) heading.current?.focus(); }, [focusHeading]);
  const sub = onlyNew
    ? (afterQueue ? 'All new ratings are placed.' : 'Nothing is waiting.') + ONLY_NEW
    : (afterQueue ? 'New ratings are placed. ' : '') + PICK_A_LIST;
  const empty = !onlyNew && !lists.length && !unrated.length;

  return (
    <div className="screen compare-home">
      <PageHeader title={HOME_TITLE} sub={sub} backTo="/more" titleRef={heading} />
      <div className="screen__body stack-18">
        {!onlyNew && lists.length > 0 && (
          <div className="stack-10">
            <div role="group" aria-label="Lists" className="cmp-tiles">
              {lists.map(({ set, label, icon, count }, i) => (
                <button key={set} type="button" className={chosen === set ? 'cmp-tile rise-in is-on' : 'cmp-tile rise-in'}
                  style={{ '--i': i } as CSSProperties} aria-pressed={chosen === set}
                  aria-label={count === null ? label : `${label} (${count})`} onClick={() => onList(set)}>
                  <span className="tile-icon"><Icon name={icon} size={18} /></span>
                  <span className="cmp-tile__name">{label}{count !== null && <> <small>({count})</small></>}</span>
                </button>
              ))}
            </div>
            {chosen !== null && tiers && <TierChipRow tiers={tiers} onTier={onTier} onRetry={onRetryTiers} />}
          </div>
        )}
        {empty && (
          <p className="compare__sub">
            Nothing to compare yet: give at least two things on a list a rating, then come back. <Link to="/">Go to your lists</Link>
          </p>
        )}
        {unrated.length > 0 && (
          <section aria-labelledby="cmp-unrated" className="stack-10">
            <div className="compare__head">
              <h2 id="cmp-unrated" className="cmp-h2">Rate finished things with no score</h2>
              <span className="compare__sub">
                Completed titles with no score yet. Lists without a Status (Movies, Albums, Songs) count everything as finished. Pick a tier for each, then a few picks place it.
              </span>
            </div>
            <div role="group" aria-label="Unrated lists" className="cmp-tiles">
              {unrated.map(({ category, count }, i) => (
                <button key={category} type="button" className="cmp-tile rise-in" style={{ '--i': lists.length + i } as CSSProperties}
                  aria-label={`${LIST_LABEL[category]} (${count})`} onClick={() => onUnrated(category)}>
                  <span className="tile-icon"><Icon name={category} size={18} /></span>
                  <span className="cmp-tile__name">{LIST_LABEL[category]}</span>
                  <span className="cmp-tile__count" aria-hidden="true">{count}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function TierChipRow({ tiers, onTier, onRetry }: { tiers: TierChips; onTier(t: Tier | null): void; onRetry(): void }) {
  if (tiers.failed) {
    return (
      <p className="compare__sub" role="alert">
        Couldn't load this list's ratings. Check your connection. <Button variant="ghost" compact onClick={onRetry}>Retry</Button>
      </p>
    );
  }
  if (tiers.counts === null) return <div aria-busy="true" aria-label="Loading tiers"><Skeleton height={44} /></div>;
  const counts = tiers.counts;
  return (
    <div role="group" aria-label="Tiers" className="cmp-chips">
      <Button variant="chip" onClick={() => onTier(null)}>All tiers</Button>
      {TIERS_TOP_FIRST.map((t) => (
        <Button key={t} variant="chip" aria-label={`${tiers.names[t]} ${counts[t]} ${counts[t] === 1 ? 'title' : 'titles'}`} onClick={() => onTier(t)}>
          {tiers.names[t]} {counts[t]}
        </Button>
      ))}
    </div>
  );
}
