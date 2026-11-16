import type { Category } from '@media-tracker/shared';
import { NavLink } from 'react-router';
import { Icon } from './Icon';
import { LIST_LABEL } from '../../nav';

/** PC side nav: brand, every enabled list (with its cached count), then Compare (with its waiting count) / Top 5 / Stats / Import / Settings / About. */
export function SideNav({ lists, counts, compareCount = 0 }: { lists: Category[]; counts: Partial<Record<Category, number>>; compareCount?: number }) {
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
        <NavLink to="/compare" className="side-nav__link side-nav__link--split" aria-label={compareCount > 0 ? `Compare, ${compareCount} waiting` : undefined}>
          <span className="side-nav__link-start"><Icon name="compare" size={18} />Compare</span>
          {compareCount > 0 && <span className="count-pill">{compareCount}</span>}
        </NavLink>
        <NavLink to="/top5" className="side-nav__link"><span className="side-nav__link-start"><Icon name="top5" size={18} />Top 5</span></NavLink>
        <NavLink to="/stats" className="side-nav__link"><span className="side-nav__link-start"><Icon name="stats" size={18} />Stats</span></NavLink>
        <NavLink to="/import" className="side-nav__link">Import</NavLink>
        <NavLink to="/settings" className="side-nav__link">Settings</NavLink>
        <NavLink to="/about" className="side-nav__link">About</NavLink>
      </div>
    </nav>
  );
}
