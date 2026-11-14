import type { Category } from '@media-tracker/shared';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../design/components/Icon';
import { LIST_LABEL } from '../../nav';
import { PageHeader } from '../../shell/PageHeader';
import type { ListCount } from './useCompareFlow';

export interface CompareHomeProps {
  afterQueue: boolean;
  lists: ListCount[];
  unrated: ListCount[];
  onlyNew: boolean;
  /** compareWindow, shown as set. */
  window: number;
  onList(c: Category): void;
  onUnrated(c: Category): void;
  /** Back from a run: focus goes to the heading so screen readers announce the home. */
  focusHeading?: boolean;
}

const ONLY_NEW = ' Settings → “Ask to compare” is set to only check new ratings.';

/** The Compare home: a full pass per list (2+ rated), and the finished titles with no rating, by list. */
export function CompareHome({ afterQueue, lists, unrated, onlyNew, window, onList, onUnrated, focusHeading }: CompareHomeProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusHeading) heading.current?.focus(); }, [focusHeading]);
  const sub = onlyNew
    ? (afterQueue ? 'All new ratings are placed.' : 'Nothing is waiting.') + ONLY_NEW
    : (afterQueue ? 'New ratings are placed. ' : '')
      + `Pick a list to go through. You only compare things rated within ${window} of each other, and you can stop any time.`;
  const empty = !onlyNew && !lists.length && !unrated.length;

  return (
    <div className="screen compare-home">
      <PageHeader title="Compare ratings" sub={sub} backTo="/more" titleRef={heading} />
      <div className="screen__body stack-18">
        {!onlyNew && lists.length > 0 && (
          <div role="group" aria-label="Lists" className="cmp-tiles">
            {lists.map(({ category, count }, i) => (
              <button key={category} type="button" className="cmp-tile rise-in" style={{ '--i': i } as CSSProperties}
                aria-label={`${LIST_LABEL[category]} (${count})`} onClick={() => onList(category)}>
                <span className="tile-icon"><Icon name={category} size={18} /></span>
                <span className="cmp-tile__name">{LIST_LABEL[category]} <small>({count})</small></span>
              </button>
            ))}
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
              <h2 id="cmp-unrated" className="cmp-h2">Rate finished things with no rating</h2>
              <span className="compare__sub">
                Completed titles with no score yet. Lists without a Status (Movies, Albums, Songs) count everything as finished. A few picks each.
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
