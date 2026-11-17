import { Link, NavLink, useLocation } from 'react-router';
import { SEARCH_PATH } from '../../nav';
import { Icon } from './Icon';

/** Screens reached from More: its tab stays current there. */
const MORE_PATHS = ['/more', '/import', '/about', '/stats', '/sharpen', '/top5'];

/** The unread count as shown: the server caps it at 99, which reads "99+". */
export const countText = (n: number): string => (n > 99 ? '99+' : String(n));

/**
 * Phone bottom bar: Home, Activity, Search (raised, centre), Messages, More. Five equal columns (Dan,
 * 2026-11-17, Phase 6 M8: Messages replaces Top 5, which is back in More; the unread badge sits on the Messages tab). Compare left with tiers (number-first, Ruling N9: Sharpen my ratings is in More). Home (`/`) opens the
 * last list shown, so it is the current tab on every list screen. Add is the floating bubble (AddBubble).
 */
export function BottomTabs({ activityCount = 0, messagesCount = 0 }: { activityCount?: number; messagesCount?: number }) {
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
      <NavLink to="/messages" className="bottom-tabs__item" aria-label={messagesCount > 0 ? `Messages, ${countText(messagesCount)} unread` : undefined}>
        <span className="bottom-tabs__icon">
          <Icon name="messages" size={22} />
          {messagesCount > 0 && <span className="count-pill bottom-tabs__count" aria-hidden="true">{countText(messagesCount)}</span>}
        </span>
        <span>Messages</span>
      </NavLink>
      <Link to="/more" className={`bottom-tabs__item${moreCurrent ? ' active' : ''}`} aria-current={moreCurrent ? 'page' : undefined}>
        <Icon name="more" size={22} />
        <span>More</span>
      </Link>
    </nav>
  );
}
