import { useState } from 'react';
import { useAppSettings } from '../data/appSettings';
import { IconButton } from '../design/components/IconButton';
import { announcementDismissed, dismissAnnouncement } from './onboarding/storage';
import '../design/onboarding.css';

/** The last day shows through; after it the banner is gone even if the cached settings still carry it (UTC, as the server counts). */
export function announcementEnded(endsAt: string | null, now: Date = new Date()): boolean {
  return endsAt !== null && endsAt < now.toISOString().slice(0, 10);
}

/**
 * AD3: the admin's announcement at the top of Home. Dismissing it is remembered on this device for that
 * announcement only (a new save has a new id, so it comes back).
 */
export function AnnouncementBanner() {
  const { announcement: a } = useAppSettings();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  if (!a || !a.text || announcementEnded(a.endsAt) || dismissedId === a.id || announcementDismissed(a.id)) return null;
  return (
    <div className="announcement" role="region" aria-label="Announcement">
      <p className="announcement__text">
        {a.text}
        {a.link && <> <a href={a.link} target="_blank" rel="noopener noreferrer" className="announcement__link">Read more<span className="sr-only"> (opens in a new tab)</span></a></>}
      </p>
      <IconButton label="Dismiss announcement" icon="close" look="plain" onClick={() => { dismissAnnouncement(a.id); setDismissedId(a.id); }} />
    </div>
  );
}
