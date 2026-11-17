import { useId } from 'react';
import { Link } from 'react-router';
import { askCloseCalls } from '../../data/ratings';
import { SETTINGS_SAVE_ERROR, useSaveSettings } from '../../data/useMe';
import { Icon } from '../../design/components/Icon';
import { useSessionMe } from '../../shell/SessionGate';

/**
 * Settings → Ratings (Ruling N9): one switch, "Ask me to compare close ratings" (stored in
 * `compareAsk`: on = Both, off = Off), and the way to Sharpen my ratings.
 */
export function CompareOptions() {
  const me = useSessionMe();
  const save = useSaveSettings({ errorToast: SETTINGS_SAVE_ERROR });
  const hint = useId();
  return (
    <div className="group__card">
      <label className="switch-row">
        <input type="checkbox" role="switch" checked={askCloseCalls(me.settings)} aria-describedby={hint}
          onChange={(e) => save.mutate({ compareAsk: e.target.checked ? 'Both' : 'Off' })} />
        <span>Ask me to compare close ratings</span>
      </label>
      <p id={hint} className="field-hint group__pad">After you rate a title, asks which you liked more when another title's number is within 0.3.</p>
      <Link to="/sharpen" className="group__row">
        <span className="group__row-start"><span className="tile-icon"><Icon name="compare" size={18} /></span>Sharpen my ratings</span>
        <span className="group__chev"><Icon name="chevron" size={18} /></span>
      </Link>
    </div>
  );
}
