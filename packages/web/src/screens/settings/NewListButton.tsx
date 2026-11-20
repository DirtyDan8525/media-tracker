import { useId } from 'react';
import { Link } from 'react-router';
import { useAppSettings } from '../../data/appSettings';
import { CUSTOM_LISTS_MAX, LIMIT_TEXT } from '../../data/customLists';
import { Icon } from '../../design/components/Icon';
import { useSessionMe } from '../../shell/SessionGate';
import { NEW_LIST_PATH } from './ListEditor';

/**
 * "+ New list" (Settings → Tabs, and the phone's More). Hidden while the admin has new lists switched off (existing lists keep
 * working). At the limit it stays, disabled, and says why.
 */
export function NewListButton({ row = false }: { row?: boolean }) {
  const me = useSessionMe();
  const { features } = useAppSettings();
  const hintId = useId();
  if (!features.customLists) return null;
  const full = me.customLists.length >= CUSTOM_LISTS_MAX;
  const cls = row ? 'group__row' : 'btn btn--secondary btn--compact new-list-btn';
  const body = row
    ? <span className="group__row-start"><span className="tile-icon"><Icon name="plus" size={18} /></span>New list</span>
    : <><Icon name="plus" size={18} />New list</>;
  if (full) {
    return (
      <div className={row ? 'new-list new-list--row' : 'new-list'}>
        <button type="button" className={cls} disabled aria-describedby={hintId}>{body}</button>
        <p id={hintId} className="hint new-list__limit">{LIMIT_TEXT}</p>
      </div>
    );
  }
  return <Link to={NEW_LIST_PATH} className={cls}>{body}</Link>;
}
