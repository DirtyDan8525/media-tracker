import type { Category } from '@media-tracker/shared';
import { useEffect } from 'react';
import { Link, matchPath, useLocation } from 'react-router';
import { Icon } from '../design/components/Icon';
import { addPath, isCategory, showsAddBubble } from '../nav';
import '../design/list-menu.css';
import { addNoun } from '../lists/registry';

/** On <html> while the bubble shows, so toasts clear it. */
export const FAB_CLASS = 'has-add-fab';

/**
 * Phase 5 (Home / AddPicker boards): the round "+" bubble, bottom right above the bar (phone only; the PC
 * side nav has its own + Add). A link to the Add sheet of the list on screen (else the last list shown);
 * the sheet's "Add to" dropdown can pick any list. Only on the lists, Activity and Search.
 */
export function AddBubble({ current }: { current: Category | null }) {
  const { pathname, search } = useLocation();
  const onList = matchPath('/list/:category', pathname)?.params.category;
  const target = isCategory(onList) ? onList : current;
  const shown = target !== null && showsAddBubble(pathname);
  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.classList.add(FAB_CLASS);
    return () => root.classList.remove(FAB_CLASS);
  }, [shown]);
  if (!shown || target === null) return null;
  const here = pathname === `/list/${target}`;
  return (
    <Link to={addPath(target, here ? search : undefined)} replace={here} className="add-fab" aria-label={`Add ${addNoun(target)}`}>
      <Icon name="plus" size={28} />
    </Link>
  );
}
