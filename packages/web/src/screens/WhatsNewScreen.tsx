import { PageHeader } from '../shell/PageHeader';
import { COMING_SOON, WHATS_NEW } from '../whatsNew';
import '../design/onboarding.css';
import '../design/settings.css';

function releaseDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** More → What's new / Coming soon (/whats-new): two plain lists, both from whatsNew.ts. */
export function WhatsNewScreen() {
  return (
    <div className="screen">
      <PageHeader title="What's new" backTo="/more" backUsesHistory />
      <div className="screen__body stack-18 whatsnew">
        <section aria-labelledby="wn-new" className="group">
          <h2 id="wn-new" className="group__title">What's new</h2>
          {WHATS_NEW.map((r) => (
            <div key={r.version} className="group__card whatsnew__release">
              <h3 className="whatsnew__version">{r.version} <span className="muted">· {releaseDate(r.date)}</span></h3>
              <ul className="whatsnew__list">
                {r.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </section>
        <section aria-labelledby="wn-soon" className="group">
          <h2 id="wn-soon" className="group__title">Coming soon</h2>
          <div className="group__card whatsnew__release">
            <ul className="whatsnew__list">
              {COMING_SOON.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
