import { Link, NavLink, useLocation } from 'react-router';
import { SEARCH_PATH } from '../../nav';
import { topOnSameScreen } from '../../shell/scrollTop';
import { Icon } from './Icon';

/** Screens reached from More: its tab stays current there. */
const MORE_PATHS = ['/more', '/import', '/about', '/stats', '/sharpen', '/top5'];

/** The unread count as shown: the server caps it at 99, which reads "99+". */
export const countText = (n: number): string => (n > 99 ? '99+' : String(n));

/** Screens under the Friends tab: the hub, friends' profiles and titles, the chats, invite links. */
const FRIENDS_PATHS = ['/friends', '/messages', '/u', '/add'];

/**
 * Phone bottom bar: Home, Activity, Search (raised, centre), Friends, More (Dan, 2026-11-17, option B: Friends replaces
 * Messages; its badge is unread messages + incoming friend requests, and Messages is the floating bubble on the Friends hub).
 * With Friends switched off but Messages on, tab 4 is Messages itself. Home (`/`) opens the last list shown, so it is the
 * current tab on every list screen; tapped there, it scrolls the list to the top. Add is the floating bubble (AddBubble).
 */
export function BottomTabs({ activityCount = 0, messagesCount = 0, friendsCount = 0, showActivity = true, showMessages = true, showFriends = true }: {
  activityCount?: number; messagesCount?: number;
  /** Incoming friend requests (the Friends badge adds the unread messages to them). */
  friendsCount?: number;
  /** The admin can switch the feed, friends and messages off (AD2): their tabs go. */
  showActivity?: boolean; showMessages?: boolean; showFriends?: boolean;
}) {
  const { pathname } = useLocation();
  const moreCurrent = MORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const homeCurrent = pathname === '/' || pathname.startsWith('/list/');
  const friendsCurrent = FRIENDS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const badge = friendsCount + (showMessages ? messagesCount : 0);
  return (
    <nav aria-label="Main" className="bottom-tabs">
      <Link to="/" className={`bottom-tabs__item${homeCurrent ? ' active' : ''}`} aria-current={homeCurrent ? 'page' : undefined}
        onClick={topOnSameScreen(pathname.startsWith('/list/'))}>
        <Icon name="home" size={22} />
        <span>Home</span>
      </Link>
      {showActivity && <NavLink to="/activity" className="bottom-tabs__item" aria-label={activityCount > 0 ? `Activity, ${countText(activityCount)} new` : undefined}>
        <span className="bottom-tabs__icon">
          <Icon name="activity" size={22} />
          {activityCount > 0 && <span className="count-pill bottom-tabs__count" aria-hidden="true">{countText(activityCount)}</span>}
        </span>
        <span>Activity</span>
      </NavLink>}
      <NavLink to={SEARCH_PATH} className="bottom-tabs__item bottom-tabs__search">
        <span className="bottom-tabs__search-circle"><Icon name="search" size={24} /></span>
        <span>Search</span>
      </NavLink>
      {showFriends ? (
        <Link to="/friends" className={`bottom-tabs__item${friendsCurrent ? ' active' : ''}`} aria-current={friendsCurrent ? 'page' : undefined}
          aria-label={badge > 0 ? `Friends, ${countText(badge)} new` : undefined}>
          <span className="bottom-tabs__icon">
            <Icon name="user" size={22} />
            {badge > 0 && <span className="count-pill bottom-tabs__count" aria-hidden="true">{countText(badge)}</span>}
          </span>
          <span>Friends</span>
        </Link>
      ) : showMessages && (
        <NavLink to="/messages" className="bottom-tabs__item" aria-label={messagesCount > 0 ? `Messages, ${countText(messagesCount)} unread` : undefined}>
          <span className="bottom-tabs__icon">
            <Icon name="messages" size={22} />
            {messagesCount > 0 && <span className="count-pill bottom-tabs__count" aria-hidden="true">{countText(messagesCount)}</span>}
          </span>
          <span>Messages</span>
        </NavLink>
      )}
      <Link to="/more" className={`bottom-tabs__item${moreCurrent ? ' active' : ''}`} aria-current={moreCurrent ? 'page' : undefined}>
        <Icon name="more" size={22} />
        <span>More</span>
      </Link>
    </nav>
  );
}
