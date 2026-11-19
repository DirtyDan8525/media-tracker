import { useId, useState } from 'react';
import { useCopy } from '../../data/social';
import { useMakePublicLink, useMyPublicLink, useTurnOffPublicLink } from '../../data/publicLink';
import { Button } from '../../design/components/Button';
import { useAppName } from '../../data/appSettings';

export const PUBLIC_LINK_NOTE = 'Anyone with the link can see your lists, ratings and notes — not private titles or private notes.';
const FAILED = "Couldn't change your public link. Try again.";

/**
 * "Public profile link" (item 34): a switch, and when on the link with Copy / Share / Make a new link.
 * The server stores only the link's hash, so the link shows right after it is made and never again; to
 * see or copy it later you make a new one (the old one stops working).
 */
export function PublicLinkRow() {
  const mine = useMyPublicLink();
  const make = useMakePublicLink();
  const off = useTurnOffPublicLink();
  const copy = useCopy();
  const appName = useAppName();
  const [failed, setFailed] = useState(false);
  const noteId = useId();
  const linkId = useId();
  const on = mine.data?.on === true;
  const link = mine.data?.link;
  const busy = make.isPending || off.isPending || mine.isPending;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function run(fn: () => Promise<unknown>) {
    setFailed(false);
    try { await fn(); } catch { setFailed(true); }
  }
  async function share(url: string) {
    try { await navigator.share({ title: appName, text: `My lists on ${appName}`, url }); } catch { /* cancelled */ }
  }

  return (
    <div className="group__pad public-link stack-10">
      <label className="switch-row">
        <input type="checkbox" role="switch" checked={on} disabled={busy} aria-describedby={noteId}
          onChange={(e) => void run(() => (e.target.checked ? make.mutateAsync() : off.mutateAsync()))} />
        <span>Public profile link</span>
      </label>
      <p id={noteId} className="field-hint">{PUBLIC_LINK_NOTE}</p>
      {on && link && (
        <div className="stack-4">
          <label htmlFor={linkId} className="field-label">Your link</label>
          <div className="text-field">
            <input id={linkId} type="text" readOnly value={link} onFocus={(e) => e.target.select()} />
          </div>
          <span className="field-hint">Copy it now: for your privacy it is shown only once.</span>
        </div>
      )}
      {on && !link && (
        <p className="field-hint">Your link is on. For your privacy it is shown only once; to see or copy it again, make a new link (the old one stops working).</p>
      )}
      {on && (
        <div className="btn-row">
          {link && <Button compact aria-label="Copy public link" onClick={() => void copy(link)}>Copy</Button>}
          {link && canShare && <Button compact aria-label="Share public link" onClick={() => void share(link)}>Share</Button>}
          <Button compact variant="ghost" disabled={busy} onClick={() => void run(() => make.mutateAsync())}>Make a new link</Button>
        </div>
      )}
      {failed && <p role="alert" className="field-error">{FAILED}</p>}
    </div>
  );
}
