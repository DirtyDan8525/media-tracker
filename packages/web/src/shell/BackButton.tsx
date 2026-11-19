import { useLocation, useNavigate } from 'react-router';
import { Icon } from '../design/components/Icon';
import { IconButton } from '../design/components/IconButton';
import { useIsWide } from '../hooks';

/** Link/navigate `state` that tells the next page where you came from, so its Back button can say so ("Back to Ren's lists"). */
export const backState = (label: string) => ({ backLabel: label });
const backLabelOf = (state: unknown): string | null => {
  const v = (state as { backLabel?: unknown } | null)?.backLabel;
  return typeof v === 'string' && v !== '' ? v : null;
};

/**
 * Back button. Phone: the round back arrow. PC has the side nav, so it shows only where a screen asks (`pc`: title pages reached from
 * another page, Dan 2026-11-19), as a text button: "Back to <where you came from>" when the link said so, else "Back".
 * With `useHistory`, it goes back to the previous in-app screen when there is one (React Router's first entry has key 'default'),
 * else to `to` (the same tab and list on a friend's profile come back with the history entry).
 */
export function BackButton({ to, useHistory = false, pc = false }: { to: string; useHistory?: boolean; pc?: boolean }) {
  const wide = useIsWide();
  const navigate = useNavigate();
  const { key, state } = useLocation();
  if (wide && !pc) return null;
  const back = () => (useHistory && key !== 'default' ? navigate(-1) : navigate(to));
  if (wide) {
    const from = backLabelOf(state);
    const label = from ? `Back to ${from}` : 'Back';
    return (
      <button type="button" className="back-link" onClick={() => void back()}>
        <Icon name="back" size={18} />{label}
      </button>
    );
  }
  return <IconButton label="Back" icon="back" look="plain" className="back-btn" onClick={() => void back()} />;
}
