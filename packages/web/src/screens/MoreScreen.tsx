import { Link } from 'react-router';
import { useCompareQueue } from '../data/compare';
import { Icon } from '../design/components/Icon';
import { COMPARE_ENABLED } from '../features';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { waitingCount } from './CompareBanner';
import { ExportRow } from './settings/ExportRow';
import '../design/settings.css';

/** Phone "More" (B20): Ratings (Compare while enabled, Top 5, Stats), Your data (Import, Export) and App (About). Lists are in the Lists menu, Settings is under Profile. */
export function MoreScreen() {
  const me = useSessionMe();
  const waiting = waitingCount(useCompareQueue().data ?? [], me.settings);
  return (
    <div className="screen">
      <PageHeader title="More" profile />
      <div className="screen__body stack-18">
        <section aria-labelledby="more-ratings" className="group">
          <h2 id="more-ratings" className="group__title">Ratings</h2>
          <div className="group__card">
            {COMPARE_ENABLED && (
              <Link to="/compare" className="group__row" aria-label={waiting > 0 ? `Compare, ${waiting} waiting` : undefined}>
                <span className="group__row-start"><span className="tile-icon"><Icon name="compare" size={18} /></span>Compare</span>
                {waiting > 0 && <span className="count-pill">{waiting}</span>}
              </Link>
            )}
            <Link to="/top5" className="group__row">
              <span className="group__row-start"><span className="tile-icon"><Icon name="top5" size={18} /></span>Top 5</span>
              <span className="group__chev"><Icon name="chevron" size={18} /></span>
            </Link>
            <Link to="/stats" className="group__row">
              <span className="group__row-start"><span className="tile-icon"><Icon name="stats" size={18} /></span>Stats</span>
              <span className="group__chev"><Icon name="chevron" size={18} /></span>
            </Link>
          </div>
        </section>
        <section aria-labelledby="more-data" className="group">
          <h2 id="more-data" className="group__title">Your data</h2>
          <div className="group__card">
            <Link to="/import" className="group__row">
              <span className="group__row-start"><span className="tile-icon"><Icon name="upload" size={18} /></span>Import from Google Sheets</span>
            </Link>
            <ExportRow />
          </div>
        </section>
        <section aria-labelledby="more-app" className="group">
          <h2 id="more-app" className="group__title">App</h2>
          <div className="group__card">
            <Link to="/about" className="group__row">About Media Tracker</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
