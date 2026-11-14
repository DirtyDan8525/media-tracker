import type { Category } from '@media-tracker/shared';
import { Link, NavLink, useLocation } from 'react-router';
import { TAB_LABEL } from '../../nav';
import { Icon } from './Icon';

/**
 * Phone bottom bar: the given lists (the first 4 enabled) + More. More is current on /more and on
 * every page reached from it (other lists, Import, Settings, About).
 */
export function BottomTabs({ lists }: { lists: Category[] }) {
  const { pathname } = useLocation();
  const onTabList = lists.some((c) => pathname === `/list/${c}` || pathname.startsWith(`/list/${c}/`));
  const moreCurrent = !onTabList && !pathname.startsWith('/entry/');
  return (
    <nav aria-label="Lists" className="bottom-tabs" style={{ gridTemplateColumns: `repeat(${lists.length + 1}, minmax(0, 1fr))` }}>
      {lists.map((c) => (
        <NavLink key={c} to={`/list/${c}`} className="bottom-tabs__item">
          <Icon name={c} size={22} />
          <span>{TAB_LABEL[c]}</span>
        </NavLink>
      ))}
      <Link to="/more" className={`bottom-tabs__item${moreCurrent ? ' active' : ''}`} aria-current={moreCurrent ? 'page' : undefined}>
        <Icon name="more" size={22} />
        <span>More</span>
      </Link>
    </nav>
  );
}
