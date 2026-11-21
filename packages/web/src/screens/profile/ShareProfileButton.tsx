import { useState } from 'react';
import { useFreshPublicLink, useMakePublicLink, useShareLink } from '../../data/publicLink';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';
import '../../design/messages.css';

export const SHARE_CONFIRM = 'This makes a link anyone can open to see your lists, ratings and notes (not private titles or private notes). You can turn it off in Edit profile.';

/**
 * The Share button in your own Profile's header (same look as a title page's Share): shares your public link.
 * With a link already on it shares at once; with none (or an old one that cannot be shown) it first asks, then
 * makes the link and shares it (Dan, 2026-11-20).
 */
export function ShareProfileButton() {
  const toast = useToast();
  const fresh = useFreshPublicLink();
  const make = useMakePublicLink();
  const share = useShareLink();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onPress() {
    if (busy) return;
    setBusy(true);
    try {
      const mine = await fresh();
      if (mine.on && mine.link) await share(mine.link);
      else setConfirm(true);
    } catch {
      toast.show("Couldn't get your link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setBusy(true);
    try {
      const { link } = await make.mutateAsync();
      setConfirm(false);
      await share(link);
    } catch {
      setConfirm(false);
      toast.show("Couldn't make your link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" className="detail-top__share" aria-label="Share your profile" title="Share your profile" aria-haspopup="dialog" disabled={busy && !confirm} onClick={() => void onPress()}>
        <Icon name="share" size={20} />Share
      </Button>
      <Sheet open={confirm} title="Share your profile?" onClose={() => setConfirm(false)}
        footer={
          <div className="crop__actions">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void onConfirm()}>Share</Button>
          </div>
        }>
        <p className="group__pad">{SHARE_CONFIRM}</p>
      </Sheet>
    </>
  );
}
