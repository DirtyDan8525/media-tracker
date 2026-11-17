import type { Category } from '@media-tracker/shared';
import { Link, NavLink } from 'react-router';
import type { Me } from '../../api/types';
import { useAppName } from '../../data/appSettings';
import { LIST_LABEL, SEARCH_PATH } from '../../nav';
import { Avatar } from './Avatar';
import { countText } from './BottomTabs';
import { Icon, type IconName } from './Icon';

/** One nav row: icon, label and (when there is something new) a count pill. `label` names the link when a count is shown. */
function Row({ to, icon, children, count = 0, countLabel }: { to: string; icon: IconName; children: string; count?: number; countLabel?: string }) {
  return (
    <NavLink to={to} className="side-nav__link side-nav__link--split"
      aria-label={count > 0 && countLabel ? `${children}, ${countText(count)} ${countLabel}` : undefined}>
      <span className="side-nav__link-start"><Icon name={icon} size={18} />{children}</span>
      {count > 0 && <span className="count-pill">{countText(count)}</span>}
    </NavLink>
  );
}

/**
 * PC side nav (PCNav board, 2026-11-17), `nav "Main"`: the logo + app name, Home, Search, Activity, Friends and Messages (each
 * with its badge), Top 5, Stats, Sharpen my ratings; a divider; the Lists group (every enabled list in the admin's order with
 * its cached count); a divider; Settings, More / About and your profile at the bottom. Rows of features the admin switched off
 * (AD2) are left out.
 */
export function SideNav({ lists, counts, activityCount = 0, messagesCount = 0, friendsCount = 0, showActivity = true, showMessages = true, showFriends = true, showSharpen = true, me }: {
  lists: Category[];
  counts: Partial<Record<Category, number>>;
  activityCount?: number;
  messagesCount?: number;
  /** Incoming friend requests (Messages has its own badge on PC). */
  friendsCount?: number;
  /** The admin can switch the feed, friends, messages and close-call questions off (AD2). */
  showActivity?: boolean;
  showMessages?: boolean;
  showFriends?: boolean;
  showSharpen?: boolean;
  me: Pick<Me, 'username' | 'email' | 'avatarAt'> & Partial<Pick<Me, 'isAdmin'>>;
}) {
  const appName = useAppName();
  return (
    <nav aria-label="Main" className="side-nav">
      <Link to="/about" className="side-nav__brand" aria-label={`About ${appName}`}>
        <img src="/favicon.svg" alt="" width={28} height={28} />
        <b>{appName}</b>
      </Link>
      <Link to="/" className="side-nav__link">
        <span className="side-nav__link-start"><Icon name="home" size={18} />Home</span>
      </Link>
      <NavLink to={SEARCH_PATH} className="side-nav__link">
        <span className="side-nav__link-start"><Icon name="search" size={18} />Search</span>
      </NavLink>
      {showActivity && <Row to="/activity" icon="activity" count={activityCount} countLabel="new">Activity</Row>}
      {showFriends && <Row to="/friends" icon="user" count={friendsCount} countLabel="new">Friends</Row>}
      {showMessages && <Row to="/messages" icon="messages" count={messagesCount} countLabel="unread">Messages</Row>}
      <Row to="/top5" icon="top5">Top 5</Row>
      <Row to="/stats" icon="stats">Stats</Row>
      {showSharpen && <Row to="/sharpen" icon="compare">Sharpen my ratings</Row>}
      {lists.length > 0 && (
        <>
          <div className="side-nav__divider" role="presentation" />
          <div className="side-nav__label" id="side-nav-lists">Lists</div>
          {lists.map((c) => (
            <NavLink key={c} to={`/list/${c}`} className="side-nav__list">
              <span>{LIST_LABEL[c]}</span>
              {counts[c] !== undefined && <span className="side-nav__count">{counts[c]}</span>}
            </NavLink>
          ))}
        </>
      )}
      <div className="side-nav__footer">
        <Row to="/settings" icon="settings">Settings</Row>
        <Row to="/more" icon="more">More / About</Row>
        <NavLink to="/profile" className="side-nav__profile" aria-label={me.username ? `Profile, @${me.username}` : 'Profile'}>
          <Avatar me={me} size={36} />
          <b className="side-nav__username">@{me.username}</b>
        </NavLink>
      </div>
    </nav>
  );
}
