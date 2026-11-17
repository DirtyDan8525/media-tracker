import type { Category } from '@media-tracker/shared';
import { Link, NavLink, useLocation } from 'react-router';
import type { Me } from '../../api/types';
import { ADD_NOUN, addPath, LIST_LABEL, SEARCH_PATH } from '../../nav';
import { useExportData } from '../../screens/settings/ExportRow';
import { Avatar } from './Avatar';
import { countText } from './BottomTabs';
import { Icon } from './Icon';

/**
 * PC side nav (B20/B21, SideNavPC board), `nav "Main"`: the profile row (32 px avatar + @username),
 * Add (a primary button-styled link to the current list's Add sheet; none while every list is off),
 * Home (the last list shown), Search, Activity, a divider, every
 * enabled list with its cached count, then Import, Export my data and About at the foot. Top 5, Stats,
 * Sharpen my ratings and Settings are reached through Profile and More (Compare left with tiers, N9).
 */
export function SideNav({ lists, counts, activityCount = 0, current, me }: {
  lists: Category[];
  counts: Partial<Record<Category, number>>;
  activityCount?: number;
  current: Category | null;
  me: Pick<Me, 'username' | 'email' | 'avatarAt'> & Partial<Pick<Me, 'isAdmin'>>;
}) {
  const { pathname, search } = useLocation();
  const exporting = useExportData();
  const onCurrentList = current !== null && pathname === `/list/${current}`;
  return (
    <nav aria-label="Main" className="side-nav">
      <NavLink to="/profile" className="side-nav__profile" aria-label={me.username ? `Profile, @${me.username}` : 'Profile'}>
        <Avatar me={me} size={32} />
        <b className="side-nav__username">@{me.username}</b>
      </NavLink>
      {current && (
        <Link to={addPath(current, onCurrentList ? search : undefined)} replace={onCurrentList} className="btn btn--primary side-nav__add" aria-label={`Add ${ADD_NOUN[current]}`}>
          <Icon name="plus" size={18} />
          <span>Add {ADD_NOUN[current]}</span>
        </Link>
      )}
      <Link to="/" className="side-nav__link">
        <span className="side-nav__link-start"><Icon name="home" size={18} />Home</span>
      </Link>
      <NavLink to={SEARCH_PATH} className="side-nav__link">
        <span className="side-nav__link-start"><Icon name="search" size={18} />Search</span>
      </NavLink>
      <NavLink to="/activity" className="side-nav__link side-nav__link--split" aria-label={activityCount > 0 ? `Activity, ${countText(activityCount)} new` : undefined}>
        <span className="side-nav__link-start"><Icon name="activity" size={18} />Activity</span>
        {activityCount > 0 && <span className="count-pill">{countText(activityCount)}</span>}
      </NavLink>
      <div className="side-nav__divider" role="presentation" />
      {lists.map((c) => (
        <NavLink key={c} to={`/list/${c}`} className="side-nav__list">
          <span>{LIST_LABEL[c]}</span>
          {counts[c] !== undefined && <span className="side-nav__count">{counts[c]}</span>}
        </NavLink>
      ))}
      <div className="side-nav__footer">
        <NavLink to="/import" className="side-nav__link">Import</NavLink>
        <button type="button" className="side-nav__link side-nav__button" disabled={exporting.busy} onClick={exporting.run}>
          {exporting.busy ? 'Exporting…' : 'Export my data'}
        </button>
        {me.isAdmin && <NavLink to="/admin" className="side-nav__link">Admin</NavLink>}
        <NavLink to="/about" className="side-nav__link">About</NavLink>
      </div>
    </nav>
  );
}
