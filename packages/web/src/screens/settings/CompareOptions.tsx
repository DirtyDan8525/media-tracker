import { COMPARE_ASK } from '@media-tracker/shared';
import { useId } from 'react';
import { Link } from 'react-router';
import { SETTINGS_SAVE_ERROR, useSaveSettings } from '../../data/useMe';
import { Icon } from '../../design/components/Icon';
import { useSessionMe } from '../../shell/SessionGate';

/** Settings → Comparing: "Ask to compare". The Sheet's other three options were dropped (Ruling Q1). */
export function CompareOptions() {
  const me = useSessionMe();
  const save = useSaveSettings({ errorToast: SETTINGS_SAVE_ERROR });
  const id = useId();
  return (
    <div className="group__card">
      <div className="option-field">
        <label htmlFor={`${id}-compareAsk`}>Ask to compare</label>
        <span className="select-wrap">
          <select id={`${id}-compareAsk`} value={me.settings.compareAsk} onChange={(e) => save.mutate({ compareAsk: e.target.value })}>
            {COMPARE_ASK.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <Icon name="chevron" size={16} />
        </span>
      </div>
      <Link to="/settings/tiers" className="group__row">
        <span className="group__row-start"><span className="tile-icon"><Icon name="stats" size={18} /></span>Rating tiers</span>
      </Link>
      <Link to="/retier/anime" className="group__row">
        <span className="group__row-start"><span className="tile-icon"><Icon name="compare" size={18} /></span>Re-tier review</span>
      </Link>
    </div>
  );
}
