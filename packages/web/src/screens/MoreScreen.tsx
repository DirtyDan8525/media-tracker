import { useState } from 'react';
import { Link } from 'react-router';
import { useAppName, useAppSettings } from '../data/appSettings';
import { useUnread } from '../data/feed';
import { Icon } from '../design/components/Icon';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { Walkthrough } from './onboarding/Walkthrough';
import { ExportRow } from './settings/ExportRow';
import '../design/settings.css';
import '../design/wide.css';

/** Phone "More" (B20): Ratings (Sharpen my ratings, Top 5, Stats), Your data (Import, Export) and App (About). Lists are in the Lists menu, Settings is under Profile. */
export function MoreScreen() {
  const me = useSessionMe();
  // The same count as the Profile dot; for the admin it includes people waiting for approval.
  const requests = useUnread().data?.requests ?? 0;
  const [tour, setTour] = useState(false);
  const appName = useAppName();
  const { features } = useAppSettings();
  return (
    <div className="screen">
      <PageHeader title="More" profile />
      <div className="screen__body stack-18 wide-cols">
        <section aria-labelledby="more-ratings" className="group">
          <h2 id="more-ratings" className="group__title">Ratings</h2>
          <div className="group__card">
            {features.closeCalls && (
              <Link to="/sharpen" className="group__row">
                <span className="group__row-start"><span className="tile-icon"><Icon name="compare" size={18} /></span>Sharpen my ratings</span>
                <span className="group__chev"><Icon name="chevron" size={18} /></span>
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
            <Link to="/import#anilist" className="group__row">
              <span className="group__row-start"><span className="tile-icon"><Icon name="upload" size={18} /></span>Import from AniList</span>
            </Link>
            <ExportRow />
          </div>
        </section>
        {me.isAdmin && (
          <section aria-labelledby="more-admin" className="group">
            <h2 id="more-admin" className="group__title">Admin</h2>
            <div className="group__card">
              <Link to="/admin" className="group__row">
                <span className="group__row-start"><span className="tile-icon"><Icon name="user" size={18} /></span>Admin</span>
                <span className="group__chev">{requests > 0 && <><span className="nav-dot nav-dot--inline" aria-hidden="true" /><span className="sr-only">{requests === 1 ? '1 new request' : `${requests} new requests`}</span></>}<Icon name="chevron" size={18} /></span>
              </Link>
            </div>
          </section>
        )}
        <section aria-labelledby="more-app" className="group">
          <h2 id="more-app" className="group__title">App</h2>
          <div className="group__card">
            {features.walkthrough && <button type="button" className="group__row" onClick={() => setTour(true)}>How to use the app</button>}
            <Link to="/help" className="group__row">Help &amp; how-tos</Link>
            <Link to="/install" className="group__row">Install instructions</Link>
            <Link to="/whats-new" className="group__row">What's new</Link>
            <Link to="/whats-new" className="group__row">Coming soon</Link>
            <Link to="/about" className="group__row">About {appName}</Link>
          </div>
        </section>
      </div>
      {tour && <Walkthrough onDone={() => setTour(false)} />}
    </div>
  );
}
