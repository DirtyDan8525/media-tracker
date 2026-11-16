import { Link } from 'react-router';
import { Icon } from '../../design/components/Icon';
import { enabledLists } from '../../nav';
import { useSessionMe } from '../../shell/SessionGate';

export const APPEARANCE_PATH = '/settings/appearance';

/**
 * Settings' "Appearance and comparing" rows (under Profile → Settings): Appearance with the current
 * theme's Background, Cards and Highlight and its name; the rating tier links (Rating tiers and
 * Re-tier review, also on the Appearance page's Comparing section); Comparing with "Ask: …".
 */
export function SettingsLinks() {
  const { settings } = useSessionMe();
  const retier = enabledLists(settings)[0];
  return (
    <>
      <Link to={APPEARANCE_PATH} className="group__row">
        <span className="group__row-start"><span className="tile-icon"><Icon name="palette" size={18} /></span>Appearance</span>{' '}
        <span className="group__value">
          <span className="theme-dots" aria-hidden="true"><i style={{ background: 'var(--bg)' }} /><i style={{ background: 'var(--card)' }} /><i style={{ background: 'var(--highlight)' }} /></span>
          {settings.theme}
        </span>
      </Link>
      <Link to="/settings/tiers" className="group__row">
        <span className="group__row-start"><span className="tile-icon"><Icon name="stats" size={18} /></span>Rating tiers</span>
      </Link>
      {retier && (
        <Link to={`/retier/${retier}`} className="group__row">
          <span className="group__row-start"><span className="tile-icon"><Icon name="tiers" size={18} /></span>Re-tier review</span>
        </Link>
      )}
      <Link to={APPEARANCE_PATH} className="group__row">
        <span className="group__row-start"><span className="tile-icon"><Icon name="compare" size={18} /></span>Comparing</span>{' '}
        <span className="group__value">Ask: {settings.compareAsk}</span>
      </Link>
    </>
  );
}
