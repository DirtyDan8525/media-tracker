import { useId, useState } from 'react';
import { NOTIFY_KEYS, type NotifyKey } from '@media-tracker/shared';
import { usePushDevice } from '../../data/push';
import { SETTINGS_SAVE_ERROR, useSaveSettings } from '../../data/useMe';
import { Button } from '../../design/components/Button';
import { useToast } from '../../design/components/Toast';
import { useSessionMe } from '../../shell/SessionGate';
import { InstallSteps } from '../onboarding/InstallSteps';

const LABELS: Record<NotifyKey, string> = {
  messages: 'Messages',
  friendRequests: 'Friend requests',
  comments: 'Comments on your posts',
  reactions: 'Reactions to your posts',
};

/**
 * Settings → Notifications (Phase 6b, P4, P6; messages, friend requests, comments and reactions since 2026-11-20). The device switch turns notifications on for THIS device
 * (it asks the browser's permission from the tap); the per-type switches are saved with the account.
 */
export function NotificationsSection() {
  const me = useSessionMe();
  const save = useSaveSettings({ errorToast: SETTINGS_SAVE_ERROR });
  const toast = useToast();
  const { state, enable, disable } = usePushDevice();
  const [installOpen, setInstallOpen] = useState(false);
  const hint = useId();
  const busy = enable.isPending || disable.isPending;
  const keys = NOTIFY_KEYS;

  function onMaster(on: boolean) {
    if (on) {
      enable.mutate(undefined, {
        onError: () => toast.show("Couldn't turn on notifications. Try again."),
        onSuccess: () => { if (Notification.permission === 'denied') toast.show('Notifications are blocked in your browser settings.'); },
      });
    } else {
      disable.mutate(undefined, { onError: () => toast.show("Couldn't turn off notifications. Try again.") });
    }
  }

  let body;
  if (state === 'loading') {
    body = <p className="field-hint group__pad">Checking…</p>;
  } else if (state === 'install') {
    body = (
      <div className="group__pad">
        <p className="field-hint">On iPhone, notifications work in the installed app only.</p>
        <Button variant="ghost" onClick={() => setInstallOpen(true)}>Install the app to get notifications</Button>
        <InstallSteps open={installOpen} onClose={() => setInstallOpen(false)} closeLabel="Close" />
      </div>
    );
  } else if (state === 'unsupported') {
    body = <p className="field-hint group__pad">This browser can't show notifications.</p>;
  } else if (state === 'not-set-up') {
    body = <p className="field-hint group__pad">Not set up yet</p>;
  } else {
    body = (
      <>
        <label className="switch-row">
          <input type="checkbox" role="switch" checked={state === 'on'} disabled={busy} aria-describedby={hint}
            onChange={(e) => onMaster(e.target.checked)} />
          <span>Notifications on this device</span>
        </label>
        <p id={hint} className="field-hint group__pad">
          {state === 'denied' ? 'Notifications are blocked in your browser settings. Allow them there, then turn this on.' : 'Get a notification for new messages, friend requests, and comments and reactions on your posts, even when the app is closed. You can mute a single chat from its menu.'}
        </p>
        {keys.map((k) => (
          <label key={k} className="switch-row">
            <input type="checkbox" role="switch" checked={me.settings.notify[k] !== false}
              onChange={(e) => save.mutate({ notify: { [k]: e.target.checked } as Record<NotifyKey, boolean> })} />
            <span>{LABELS[k]}</span>
          </label>
        ))}
      </>
    );
  }

  return (
    <section aria-labelledby="set-notify" className="group">
      <h2 id="set-notify" className="group__title">Notifications</h2>
      <div className="group__card">{body}</div>
    </section>
  );
}
