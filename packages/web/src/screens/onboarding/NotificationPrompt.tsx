import { useEffect, useState } from 'react';
import { usePushDevice } from '../../data/push';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';
import { useMediaQuery } from '../../hooks';
import { useSessionMe } from '../../shell/SessionGate';
import '../../design/onboarding.css';
import { markNotifyPromptSeen, notifyPromptSeen } from './storage';

/** Waits after the app is ready, then re-checks this often while another dialog or the keyboard is in the way. Tests shorten it. */
export const PROMPT_TIMING = { delayMs: 2500, retryMs: 2000 };

/** A phone: a touch screen, or the phone layout (narrower than 1024 px). */
const COARSE = '(pointer: coarse)';
const NARROW = '(max-width: 1023px)';

const busyElsewhere = (): boolean =>
  document.querySelector('[role="dialog"]') !== null || document.documentElement.classList.contains('kbd-open');

/**
 * One-time "Notifications are here" popup on phones. Shown only when this device could turn notifications on
 * (the server has a key, the browser supports push, not subscribed, not blocked) and hasn't seen it before.
 * iPhone in Safari (not installed) is skipped: the switch can't work there, and Settings explains the install.
 * Mount it only when no walkthrough or install steps are showing; it also holds back while any other dialog is open
 * or the keyboard is up. "Turn on" runs the Settings subscribe flow from the tap so the permission prompt is allowed.
 */
export function NotificationPrompt() {
  const me = useSessionMe();
  const toast = useToast();
  const coarse = useMediaQuery(COARSE);
  const narrow = useMediaQuery(NARROW);
  const phone = coarse || narrow;
  const { state, enable } = usePushDevice();
  const [seen, setSeen] = useState(notifyPromptSeen);
  const [open, setOpen] = useState(false);
  const eligible = phone && !seen && me.status === 'active' && state === 'off';

  useEffect(() => {
    if (!eligible || open) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { if (busyElsewhere()) t = setTimeout(tick, PROMPT_TIMING.retryMs); else setOpen(true); };
    t = setTimeout(tick, PROMPT_TIMING.delayMs);
    return () => clearTimeout(t);
  }, [eligible, open]);

  function close() {
    markNotifyPromptSeen();
    setSeen(true);
    setOpen(false);
  }

  function turnOn() {
    markNotifyPromptSeen(); // asked once, whatever the answer
    enable.mutate(undefined, {
      onError: () => toast.show("Couldn't turn on notifications. Try again."),
      onSuccess: () => {
        if (Notification.permission === 'granted') toast.show('Notifications on');
        else if (Notification.permission === 'denied') toast.show('Notifications are blocked in your browser settings.');
        setSeen(true);
        setOpen(false);
      },
    });
  }

  if (!open) return null;
  return (
    <Sheet open title="Notifications are here" onClose={close}
      footer={(
        <div className="notify-prompt__actions">
          <Button variant="primary" disabled={enable.isPending} onClick={turnOn}>Turn on</Button>
          <Button onClick={close}>Not now</Button>
        </div>
      )}>
      <p>Get a notification for new messages, friend requests, and comments or reactions on your posts. You can change this any time in Settings.</p>
    </Sheet>
  );
}
