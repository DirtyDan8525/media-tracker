import { useState } from 'react';
import { useSaveSettings } from '../data/useMe';
import { Button } from '../design/components/Button';
import { useToast } from '../design/components/Toast';
import { TAB_SWITCHES } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { FillDetailsRow } from './settings/FillDetailsRow';
import { useSessionMe } from '../shell/SessionGate';
import { UsernameForm } from './UsernameForm';

/** Settings (Phase 1–2): tab switches, "Fill in details", username, and the current theme's name. */
export function SettingsScreen() {
  const me = useSessionMe();
  const save = useSaveSettings();
  const toast = useToast();
  const [editingName, setEditingName] = useState(false);

  function toggle(key: string, on: boolean) {
    save.mutate({ tabs: { [key]: on } }, { onError: () => toast.show("Couldn't save your settings. Try again.") });
  }

  return (
    <div className="screen">
      <PageHeader title="Settings" backTo="/more" />
      <div className="screen__body stack-18">
        <section aria-labelledby="set-tabs" className="group">
          <h2 id="set-tabs" className="group__title">Tabs</h2>
          <div className="group__card switch-grid">
            {TAB_SWITCHES.map(({ key, label }) => (
              <label key={key} className="switch-row">
                <input type="checkbox" role="switch" checked={me.settings.tabs[key] !== false}
                  onChange={(e) => toggle(key, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section aria-labelledby="set-data" className="group">
          <h2 id="set-data" className="group__title">Your data</h2>
          <div className="group__card">
            <FillDetailsRow />
          </div>
        </section>

        <section aria-labelledby="set-acct" className="group">
          <h2 id="set-acct" className="group__title">Account</h2>
          <div className="group__card">
            {editingName ? (
              <div className="group__pad">
                <UsernameForm
                  initial={me.username ?? ''}
                  submitLabel="Save"
                  onSaved={() => { setEditingName(false); toast.show('Username saved'); }}
                  extra={<Button variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>}
                />
              </div>
            ) : (
              <div className="group__row">
                <span>Username</span>
                <span className="group__row-end">
                  <span className="group__value">@{me.username}</span>
                  <Button variant="ghost" compact aria-label="Change username" onClick={() => setEditingName(true)}>Change</Button>
                </span>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="set-look" className="group">
          <h2 id="set-look" className="group__title">Appearance</h2>
          <div className="group__card">
            <div className="group__row"><span>Theme: {me.settings.theme}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
