import type { Category } from '@media-tracker/shared';
import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import type { Me } from '../../api/types';
import { useAppName } from '../../data/appSettings';
import { SEARCH_PATH } from '../../nav';
import { ListIcon } from '../../lists/ListIcon';
import { topOnSameScreen } from '../../shell/scrollTop';
import { ListsOrderSheet } from '../../shell/ListsOrderSheet';
import { clampNavWidth, defaultNavWidth, NAV_MAX_W, NAV_MIN_W, NAV_NUDGE_PX } from '../../shell/navWidth';
import { Avatar } from './Avatar';
import { countText } from './BottomTabs';
import { Icon, type IconName } from './Icon';
import { listLabel, listName, useListRegistry } from '../../lists/registry';

/** One nav row: icon, label and (when there is something new) a count pill. Collapsed (the icon rail): the label is the link's name and tooltip, the pill stays on the icon. */
function Row({ to, icon, children, count = 0, countLabel, collapsed = false, onClick }: { to: string; icon: IconName; children: string; count?: number; countLabel?: string; collapsed?: boolean; onClick?: (e: MouseEvent<HTMLElement>) => void }) {
  const name = count > 0 && countLabel ? `${children}, ${countText(count)} ${countLabel}` : children;
  if (collapsed) {
    return (
      <NavLink to={to} className="side-nav__link side-nav__link--rail" aria-label={name} title={children} onClick={onClick}>
        <span className="side-nav__rail-icon">
          <Icon name={icon} size={20} />
          {count > 0 && <span className="count-pill side-nav__rail-count" aria-hidden="true">{countText(count)}</span>}
        </span>
      </NavLink>
    );
  }
  return (
    <NavLink to={to} className="side-nav__link side-nav__link--split" onClick={onClick}
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
 * (AD2) are left out. A "Collapse" row at the bottom folds it to a 72 px icon rail (`collapsed`; Dan, 2026-11-18); the brand keeps the whole header. A drag handle on the inner edge resizes it (200 to 360 px), and "Reorder lists" above Settings opens your own list order.
 */
export function SideNav({ lists, counts, activityCount = 0, messagesCount = 0, friendsCount = 0, showActivity = true, showMessages = true, showFriends = true, showSharpen = true, me, collapsed = false, onToggleCollapsed, side = 'left', width = null, onWidthChange, onWidthReset }: {
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
  /** Which side the nav sits on: the resize handle is on the edge facing the content. */
  side?: 'left' | 'right';
  /** The saved width in px (null = the default). Only used while expanded. */
  width?: number | null;
  onWidthChange?: (w: number) => void;
  onWidthReset?: () => void;
}) {
  const appName = useAppName();
  const { pathname } = useLocation();
  // Tapping the row for the list you are already on scrolls it to the top (Home too: it opens the list on screen).
  const onList = (c: string) => topOnSameScreen(pathname === `/list/${c}`);
  useListRegistry(); // a renamed list shows at once
  const friendsBadge = friendsCount + (showMessages ? messagesCount : 0);
  const rowProps = { collapsed };
  const toggleLabel = collapsed ? 'Expand side bar' : 'Collapse side bar';
  const [reorder, setReorder] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const shownWidth = width ?? defaultNavWidth(typeof window === 'undefined' ? 0 : window.innerWidth);
  // The handle sits on the nav's inner edge: dragging toward the content widens a left nav and narrows a right one.
  const sign = side === 'right' ? -1 : 1;
  const onGripDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, w: navRef.current?.getBoundingClientRect().width || shownWidth };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };
  const onGripMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) onWidthChange?.(clampNavWidth(d.w + sign * (e.clientX - d.x)));
  };
  const onGripUp = () => { drag.current = null; setDragging(false); };
  const onGripKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? NAV_NUDGE_PX * sign : e.key === 'ArrowLeft' ? -NAV_NUDGE_PX * sign : 0;
    if (step !== 0) onWidthChange?.(clampNavWidth(shownWidth + step));
    else if (e.key === 'Home') onWidthChange?.(NAV_MIN_W);
    else if (e.key === 'End') onWidthChange?.(NAV_MAX_W);
    else return;
    e.preventDefault();
  };
  const navStyle = !collapsed && width !== null ? ({ '--side-nav-w': `${width}px` } as CSSProperties) : undefined;
  return (
    <>
    <nav aria-label="Main" ref={navRef} className={`side-nav${collapsed ? ' side-nav--collapsed' : ''}`} style={navStyle}>
      <div className="side-nav__head">
        <Link to="/about" className="side-nav__brand" aria-label={`About ${appName}`} title={collapsed ? appName : undefined}>
          <img src="/favicon.svg" alt="" width={28} height={28} />
          {!collapsed && <b>{appName}</b>}
        </Link>
      </div>
      <Row to="/" icon="home" onClick={topOnSameScreen(pathname.startsWith('/list/'))} {...rowProps}>Home</Row>
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
                <NavLink key={c} to={`/list/${c}`} className="side-nav__link side-nav__link--rail" aria-label={listLabel(c)} title={listLabel(c)} onClick={onList(c)}>
                  <span className="side-nav__rail-icon"><ListIcon c={c} size={20} /></span>
                </NavLink>
              ))}
            </div>
          ) : (
            <>
              <div className="side-nav__label" id="side-nav-lists">Lists</div>
              {lists.map((c) => (
                <NavLink key={c} to={`/list/${c}`} className="side-nav__list" onClick={onList(c)}>
                  <span>{listName(c)}</span>
                  {counts[c] !== undefined && <span className="side-nav__count">{counts[c]}</span>}
                </NavLink>
              ))}
            </>
          )}
        </>
      )}
      <div className="side-nav__footer">
        {collapsed ? (
          <button type="button" className="side-nav__link side-nav__link--rail side-nav__button" aria-label="Reorder lists" title="Reorder lists" onClick={() => setReorder(true)}>
            <span className="side-nav__rail-icon"><Icon name="lists" size={20} /></span>
          </button>
        ) : (
          <button type="button" className="side-nav__link side-nav__button" onClick={() => setReorder(true)}>
            <span className="side-nav__link-start"><Icon name="lists" size={18} />Reorder lists</span>
          </button>
        )}
        <Row to="/settings" icon="settings" {...rowProps}>Settings</Row>
        <Row to="/more" icon="more" {...rowProps}>More / About</Row>
        {onToggleCollapsed && (
          <button type="button" className={`side-nav__link side-nav__button side-nav__collapse${collapsed ? ' side-nav__link--rail' : ''}`}
            aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed} onClick={onToggleCollapsed}>
            <span className="side-nav__link-start">
              <span className="side-nav__toggle-icon"><Icon name="chevron" size={18} /></span>
              {!collapsed && 'Collapse'}
            </span>
          </button>
        )}
        <NavLink to="/profile" className="side-nav__profile" aria-label={me.username ? `Profile, @${me.username}` : 'Profile'} title={collapsed ? `@${me.username}` : undefined}>
          <Avatar me={me} size={36} />
          {!collapsed && <b className="side-nav__username">@{me.username}</b>}
        </NavLink>
      </div>
    </nav>
    {!collapsed && onWidthChange && (
      <div className="side-nav-resize">
        <div role="separator" aria-orientation="vertical" aria-label="Resize side bar" tabIndex={0} title="Drag to resize. Arrow keys resize by 16 px. Double-click to reset."
          aria-valuenow={shownWidth} aria-valuemin={NAV_MIN_W} aria-valuemax={NAV_MAX_W} className={`side-nav-resize__grip${dragging ? ' is-dragging' : ''}`}
          onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}
          onKeyDown={onGripKey} onDoubleClick={() => onWidthReset?.()} />
      </div>
    )}
    {reorder && <ListsOrderSheet open onClose={() => setReorder(false)} />}
    </>
  );
}
