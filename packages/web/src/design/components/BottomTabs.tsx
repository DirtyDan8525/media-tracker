import { Link, NavLink, useLocation } from 'react-router';
import { SEARCH_PATH } from '../../nav';
import { Icon } from './Icon';

/** Screens reached from More: its tab stays current there. */
const MORE_PATHS = ['/more', '/import', '/about', '/top5', '/stats'];

/** The unread count as shown: the server caps it at 99, which reads "99+". */
export const countText = (n: number): string => (n > 99 ? '99+' : String(n));

/**
 * Phone bottom bar (Home board): Home, Activity, Search (raised, centre), Compare (slot 4 is always
 * Compare, decisions 2026-11-15 Amendments), More. Five equal columns. Home (`/`) opens the last list
 * shown, so it is the current tab on every list screen. Add is the floating bubble (AddBubble).
 */
export function BottomTabs({ compareCount, activityCount = 0 }: { compareCount: number; activityCount?: number }) {
  const { pathname } = useLocation();
  const moreCurrent = MORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const homeCurrent = pathname === '/' || pathname.startsWith('/list/');
  return (
    <nav aria-label="Main" className="bottom-tabs">
      <Link to="/" className={`bottom-tabs__item${homeCurrent ? ' active' : ''}`} aria-current={homeCurrent ? 'page' : undefined}>
        <Icon name="home" size={22} />
        <span>Home</span>
      </Link>
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
