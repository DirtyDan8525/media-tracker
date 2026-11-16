import type { Category } from '@media-tracker/shared';
import { Link, NavLink, useLocation } from 'react-router';
import { ADD_NOUN, addPath, SEARCH_PATH } from '../../nav';
import { Icon } from './Icon';

/** Screens reached from More: its tab stays current there. */
const MORE_PATHS = ['/more', '/import', '/about', '/top5', '/stats'];

/** The unread count as shown: the server caps it at 99, which reads "99+". */
export const countText = (n: number): string => (n > 99 ? '99+' : String(n));

/**
 * Phone bottom bar (B2, NavBar board): Add, Activity, Search (raised, centre), Compare (slot 4 is
 * always Compare, decisions 2026-11-15 Amendments), More. Five equal columns.
 * Add opens the current list's Add sheet (B3); with no list on there is no Add (an empty cell).
 */
export function BottomTabs({ current, compareCount, activityCount = 0 }: { current: Category | null; compareCount: number; activityCount?: number }) {
  const { pathname, search } = useLocation();
  const moreCurrent = MORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const onCurrentList = current !== null && pathname === `/list/${current}`;
  return (
    <nav aria-label="Main" className="bottom-tabs">
      {current ? (
        <Link to={addPath(current, onCurrentList ? search : undefined)} replace={onCurrentList} className="bottom-tabs__item" aria-label={`Add ${ADD_NOUN[current]}`}>
          <Icon name="plus" size={22} />
          <span>Add</span>
        </Link>
      ) : <span className="bottom-tabs__empty" aria-hidden="true" />}
      <NavLink to="/activity" className="bottom-tabs__item" aria-label={activityCount > 0 ? `Activity, ${countText(activityCount)} new` : undefined}>
        <span className="bottom-tabs__icon">
          <Icon name="activity" size={22} />
          {activityCount > 0 && <span className="count-pill bottom-tabs__count" aria-hidden="true">{countText(activityCount)}</span>}
        </span>
        <span>Activity</span>
      </NavLink>
      <NavLink to={SEARCH_PATH} className="bottom-tabs__item bottom-tabs__search">
        <span className="bottom-tabs__search-circle"><Icon name="search" size={24} /></span>
        <span>Search</span>
      </NavLink>
      <NavLink to="/compare" className="bottom-tabs__item" aria-label={compareCount > 0 ? `Compare, ${compareCount} waiting` : undefined}>
        <span className="bottom-tabs__icon">
          <Icon name="compare" size={22} />
          {compareCount > 0 && <span className="count-pill bottom-tabs__count" aria-hidden="true">{compareCount}</span>}
        </span>
        <span>Compare</span>
      </NavLink>
      <Link to="/more" className={`bottom-tabs__item${moreCurrent ? ' active' : ''}`} aria-current={moreCurrent ? 'page' : undefined}>
        <Icon name="more" size={22} />
        <span>More</span>
      </Link>
    </nav>
  );
}
