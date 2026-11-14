import { Link } from 'react-router';
import { useListCounts } from '../data/useEntries';
import { Icon } from '../design/components/Icon';
import { enabledLists, LIST_LABEL, splitForPhone } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';

/** Phone "More": the enabled lists that don't fit the bottom bar, then Import, Settings and About. */
export function MoreScreen() {
  const me = useSessionMe();
  const counts = useListCounts().data ?? {};
  const { more } = splitForPhone(enabledLists(me.settings));
  return (
    <div className="screen">
      <PageHeader title="More" />
      <div className="screen__body stack-18">
        {more.length > 0 && (
          <section aria-labelledby="more-lists" className="group">
            <h2 id="more-lists" className="group__title">Other lists</h2>
            <div className="group__card">
              {more.map((c) => (
                <Link key={c} to={`/list/${c}`} className="group__row">
                  <span className="group__row-start"><span className="tile-icon"><Icon name={c} size={18} /></span>{LIST_LABEL[c]}</span>
                  {counts[c] !== undefined && <span className="group__value">{counts[c]}</span>}
                </Link>
              ))}
            </div>
          </section>
        )}
        <section aria-labelledby="more-data" className="group">
          <h2 id="more-data" className="group__title">Your data</h2>
          <div className="group__card">
            <Link to="/import" className="group__row">Import from Google Sheets</Link>
          </div>
        </section>
        <section aria-labelledby="more-app" className="group">
          <h2 id="more-app" className="group__title">App</h2>
          <div className="group__card">
            <Link to="/settings" className="group__row">Settings</Link>
            <Link to="/about" className="group__row">About Media Tracker</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
