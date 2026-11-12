import type { Category } from '@media-tracker/shared';
import { NavLink } from 'react-router';
import { LIST_LABEL } from '../../nav';

/** PC side nav: brand, every enabled list (with its cached count), then Import / Settings / About. */
export function SideNav({ lists, counts }: { lists: Category[]; counts: Partial<Record<Category, number>> }) {
  return (
    <nav aria-label="Lists" className="side-nav">
      <span className="side-nav__brand">Media Tracker</span>
      {lists.map((c) => (
        <NavLink key={c} to={`/list/${c}`} className="side-nav__list">
          <span>{LIST_LABEL[c]}</span>
          {counts[c] !== undefined && <span className="side-nav__count">{counts[c]}</span>}
        </NavLink>
      ))}
      <div className="side-nav__footer">
        <NavLink to="/import" className="side-nav__link">Import</NavLink>
        <NavLink to="/settings" className="side-nav__link">Settings</NavLink>
        <NavLink to="/about" className="side-nav__link">About</NavLink>
      </div>
    </nav>
  );
}
