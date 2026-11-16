import type { Category } from '@media-tracker/shared';
import { Link, NavLink, useLocation } from 'react-router';
import { COMPARE_ENABLED } from '../../features';
import { ADD_NOUN, addPath, SEARCH_PATH } from '../../nav';
import { Icon } from './Icon';

/** Screens reached from More: its tab stays current there. */
const MORE_PATHS = ['/more', '/import', '/about', '/top5', '/stats'];

/**
 * Phone bottom bar (B2, NavBar board): Add, Activity, Search (raised, centre), Compare (only while
 * Compare is enabled; otherwise an empty cell so Search stays centred), More. Five equal columns.
 * Add opens the current list's Add sheet (B3); with no list on there is no Add (an empty cell).
 */
export function BottomTabs({ current, compareCount }: { current: Category | null; compareCount: number }) {
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
      <NavLink to="/activity" className="bottom-tabs__item">
        <Icon name="activity" size={22} />
        <span>Activity</span>
      </NavLink>
      <NavLink to={SEARCH_PATH} className="bottom-tabs__item bottom-tabs__search">
        <span className="bottom-tabs__search-circle"><Icon name="search" size={24} /></span>
        <span>Search</span>
      </NavLink>
      {COMPARE_ENABLED ? (
        <NavLink to="/compare" className="bottom-tabs__item" aria-label={compareCount > 0 ? `Compare, ${compareCount} waiting` : undefined}>
          <span className="bottom-tabs__icon">
            <Icon name="compare" size={22} />
            {compareCount > 0 && <span className="count-pill bottom-tabs__count" aria-hidden="true">{compareCount}</span>}
          </span>
          <span>Compare</span>
        </NavLink>
      ) : <span className="bottom-tabs__empty" aria-hidden="true" />}
      <Link to="/more" className={`bottom-tabs__item${moreCurrent ? ' active' : ''}`} aria-current={moreCurrent ? 'page' : undefined}>
        <Icon name="more" size={22} />
        <span>More</span>
      </Link>
    </nav>
  );
}
