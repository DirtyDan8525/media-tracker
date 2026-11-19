import type { Category } from '@media-tracker/shared';
import { Link, NavLink } from 'react-router';
import type { Me } from '../../api/types';
import { useAppName } from '../../data/appSettings';
import { LIST_LABEL, SEARCH_PATH } from '../../nav';
import { Avatar } from './Avatar';
import { countText } from './BottomTabs';
import { Icon, type IconName } from './Icon';

/** One nav row: icon, label and (when there is something new) a count pill. Collapsed (the icon rail): the label is the link's name and tooltip, the pill stays on the icon. */
function Row({ to, icon, children, count = 0, countLabel, collapsed = false }: { to: string; icon: IconName; children: string; count?: number; countLabel?: string; collapsed?: boolean }) {
  const name = count > 0 && countLabel ? `${children}, ${countText(count)} ${countLabel}` : children;
  if (collapsed) {
    return (
      <NavLink to={to} className="side-nav__link side-nav__link--rail" aria-label={name} title={children}>
        <span className="side-nav__rail-icon">
          <Icon name={icon} size={20} />
          {count > 0 && <span className="count-pill side-nav__rail-count" aria-hidden="true">{countText(count)}</span>}
        </span>
      </NavLink>
    );
  }
  return (
    <NavLink to={to} className="side-nav__link side-nav__link--split"
      aria-label={count > 0 && countLabel ? name : undefined}>
      <span className="side-nav__link-start"><Icon name={icon} size={18} />{children}</span>
      {count > 0 && <span className="count-pill">{countText(count)}</span>}
    </NavLink>
  );
}

/**
 * PC side nav (PCNav board, 2026-11-17), `nav "Main"`: the logo + app name, Home, Search, Activity, Friends (one row like the
 * phone's tab; its badge is unread messages + requests, and Messages opens from the Friends page), Top 5, Stats, Sharpen my ratings; a divider; the Lists group (every enabled list in the admin's order with
 * its cached count); a divider; Settings, More / About and your profile at the bottom. Rows of features the admin switched off
 * (AD2) are left out. A chevron button folds it to a 72 px icon rail (`collapsed`; Dan, 2026-11-18).
 */
export function SideNav({ lists, counts, activityCount = 0, messagesCount = 0, friendsCount = 0, showActivity = true, showMessages = true, showFriends = true, showSharpen = true, me, collapsed = false, onToggleCollapsed }: {
  lists: Category[];
  counts: Partial<Record<Category, number>>;
  activityCount?: number;
  messagesCount?: number;
  /** Incoming friend requests (the Friends badge adds the unread messages to them, like the phone's tab). */
  friendsCount?: number;
  /** The admin can switch the feed, friends, messages and close-call questions off (AD2). */
  showActivity?: boolean;
  showMessages?: boolean;
  showFriends?: boolean;
  showSharpen?: boolean;
  me: Pick<Me, 'username' | 'email' | 'avatarAt'> & Partial<Pick<Me, 'isAdmin'>>;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const appName = useAppName();
  const friendsBadge = friendsCount + (showMessages ? messagesCount : 0);
  const rowProps = { collapsed };
  const toggleLabel = collapsed ? 'Expand side bar' : 'Collapse side bar';
  return (
    <nav aria-label="Main" className={`side-nav${collapsed ? ' side-nav--collapsed' : ''}`}>
      <div className="side-nav__head">
        <Link to="/about" className="side-nav__brand" aria-label={`About ${appName}`} title={collapsed ? appName : undefined}>
          <img src="/favicon.svg" alt="" width={28} height={28} />
          {!collapsed && <b>{appName}</b>}
        </Link>
        {onToggleCollapsed && (
          <button type="button" className="side-nav__toggle" aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed}
            onClick={onToggleCollapsed}>
            <span className="side-nav__toggle-icon"><Icon name="chevron" size={18} /></span>
          </button>
        )}
      </div>
      <Row to="/" icon="home" {...rowProps}>Home</Row>
      <Row to={SEARCH_PATH} icon="search" {...rowProps}>Search</Row>
      {showActivity && <Row to="/activity" icon="activity" count={activityCount} countLabel="new" {...rowProps}>Activity</Row>}
      {showFriends
        ? <Row to="/friends" icon="user" count={friendsBadge} countLabel="new" {...rowProps}>Friends</Row>
        : showMessages && <Row to="/messages" icon="messages" count={messagesCount} countLabel="unread" {...rowProps}>Messages</Row>}
      <Row to="/top5" icon="top5" {...rowProps}>Top 5</Row>
      <Row to="/stats" icon="stats" {...rowProps}>Stats</Row>
      {showSharpen && <Row to="/sharpen" icon="compare" {...rowProps}>Sharpen my ratings</Row>}
      {lists.length > 0 && (
        <>
          <div className="side-nav__divider" role="presentation" />
          {collapsed ? (
            <div role="group" aria-label="Lists" className="side-nav__rail-lists">
              {lists.map((c) => (
                <NavLink key={c} to={`/list/${c}`} className="side-nav__link side-nav__link--rail" aria-label={LIST_LABEL[c]} title={LIST_LABEL[c]}>
                  <span className="side-nav__rail-icon"><Icon name={c} size={20} /></span>
                </NavLink>
              ))}
            </div>
          ) : (
            <>
              <div className="side-nav__label" id="side-nav-lists">Lists</div>
              {lists.map((c) => (
                <NavLink key={c} to={`/list/${c}`} className="side-nav__list">
                  <span>{LIST_LABEL[c]}</span>
                  {counts[c] !== undefined && <span className="side-nav__count">{counts[c]}</span>}
                </NavLink>
              ))}
            </>
          )}
        </>
      )}
      <div className="side-nav__footer">
        <Row to="/settings" icon="settings" {...rowProps}>Settings</Row>
        <Row to="/more" icon="more" {...rowProps}>More / About</Row>
        <NavLink to="/profile" className="side-nav__profile" aria-label={me.username ? `Profile, @${me.username}` : 'Profile'} title={collapsed ? `@${me.username}` : undefined}>
          <Avatar me={me} size={36} />
          {!collapsed && <b className="side-nav__username">@{me.username}</b>}
        </NavLink>
      </div>
    </nav>
  );
}
