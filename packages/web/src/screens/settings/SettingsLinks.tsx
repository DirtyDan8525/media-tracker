import { Link } from 'react-router';
import { Icon } from '../../design/components/Icon';
import { COMPARE_ENABLED } from '../../features';
import { useSessionMe } from '../../shell/SessionGate';

export const APPEARANCE_PATH = '/settings/appearance';

/**
 * The rows that open the Appearance page (SettingsMore.v2's "Settings" section): Appearance with
 * the current theme's Background, Cards and Highlight and its name; Comparing with "Ask: …" (only while Compare is enabled).
 */
export function SettingsLinks() {
  const { settings } = useSessionMe();
  return (
    <>
      <Link to={APPEARANCE_PATH} className="group__row">
        <span className="group__row-start"><span className="tile-icon"><Icon name="palette" size={18} /></span>Appearance</span>{' '}
        <span className="group__value">
          <span className="theme-dots" aria-hidden="true"><i style={{ background: 'var(--bg)' }} /><i style={{ background: 'var(--card)' }} /><i style={{ background: 'var(--highlight)' }} /></span>
          {settings.theme}
        </span>
      </Link>
      {COMPARE_ENABLED && (
        <Link to={APPEARANCE_PATH} className="group__row">
          <span className="group__row-start"><span className="tile-icon"><Icon name="compare" size={18} /></span>Comparing</span>{' '}
          <span className="group__value">Ask: {settings.compareAsk}</span>
        </Link>
      )}
    </>
  );
}
