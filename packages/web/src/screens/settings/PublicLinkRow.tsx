import { useId, useState } from 'react';
import { useCopy } from '../../data/social';
import { useMakePublicLink, useMyPublicLink, useTurnOffPublicLink } from '../../data/publicLink';
import { Button } from '../../design/components/Button';
import { useAppName } from '../../data/appSettings';

export const PUBLIC_LINK_NOTE = 'Anyone with the link can see your lists, ratings and notes — not private titles or private notes.';
const FAILED = "Couldn't change your public link. Try again.";

/**
 * "Public profile link" (item 34): a switch, and when on the link with Copy / Share / Make a new link.
 * The server stores the link (migration 0024), so it is shown every time while on. A link made before that
 * has no stored token (`legacy`): it still works, and "Make a new link to share" replaces it.
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
  const link = mine.data?.link ?? undefined;
  const legacy = on && !link;
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
        </div>
      )}
      {legacy && (
        <p className="field-hint">Your link is on, but it was made before links could be saved, so it can't be shown here. Make a new link to share (the old one keeps working until then).</p>
      )}
      {on && (
        <div className="btn-row">
          {link && <Button compact aria-label="Copy public link" onClick={() => void copy(link)}>Copy</Button>}
          {link && canShare && <Button compact aria-label="Share public link" onClick={() => void share(link)}>Share</Button>}
          <Button compact variant="ghost" disabled={busy} onClick={() => void run(() => make.mutateAsync())}>
            {legacy ? 'Make a new link to share' : 'Make a new link'}
          </Button>
        </div>
      )}
      {on && link && <p className="field-hint">Making a new link stops the current one from working.</p>}
      {failed && <p role="alert" className="field-error">{FAILED}</p>}
    </div>
  );
}
