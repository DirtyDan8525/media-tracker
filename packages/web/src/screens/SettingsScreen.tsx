import { SEARCH_SCOPE } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { inviteLink, useCopy, useInviteCode, useSaveDisplayName } from '../data/social';
import { SETTINGS_SAVE_ERROR, useSaveSettings } from '../data/useMe';
import { Button } from '../design/components/Button';
import { useToast } from '../design/components/Toast';
import { TAB_SWITCHES } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { ExportRow } from './settings/ExportRow';
import { FillDetailsRow } from './settings/FillDetailsRow';
import { CompareOptions } from './settings/CompareOptions';
import { NotificationsSection } from './settings/NotificationsSection';
import { SettingsLinks } from './settings/SettingsLinks';
import { useSessionMe } from '../shell/SessionGate';
import { UsernameForm } from './UsernameForm';
import { SegRadio } from '../design/components/SegRadio';
import '../design/search.css';
import '../design/settings.css';
import '../design/wide.css';

/**
 * Settings: tab switches, search, "Fill in details", "Export my data", username, Ratings ("Ask me to
 * compare close ratings" and Sharpen my ratings, Ruling N9) and the Appearance page (theme, Custom colours).
 */
export function SettingsScreen() {
  const me = useSessionMe();
  const save = useSaveSettings({ errorToast: SETTINGS_SAVE_ERROR });
  const toast = useToast();
  const [editingName, setEditingName] = useState(false);

  function toggle(key: string, on: boolean) {
    save.mutate({ tabs: { [key]: on } });
  }

  return (
    <div className="screen">
      <PageHeader title="Settings" backTo="/profile" backUsesHistory />
      <div className="screen__body stack-18 wide-cols">
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

        <section aria-labelledby="set-search" className="group">
          <h2 id="set-search" className="group__title">Search</h2>
          <div className="group__card group__pad">
            <SegRadio label="Where Search looks" value={me.settings.searchScope}
              options={SEARCH_SCOPE.map((v) => ({ value: v, label: v === 'all' ? 'All lists' : 'Only the current list' }))}
              onChange={(v) => { if (me.settings.searchScope !== v) save.mutate({ searchScope: v }); }} />
          </div>
        </section>

        <section aria-labelledby="set-data" className="group">
          <h2 id="set-data" className="group__title">Your data</h2>
          <div className="group__card">
            <FillDetailsRow />
            <ExportRow />
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
            <DisplayNameRow />
            <InviteLinkRow />
          </div>
        </section>

        <NotificationsSection />

        <section aria-labelledby="set-ratings" className="group">
          <h2 id="set-ratings" className="group__title">Ratings</h2>
          <CompareOptions />
        </section>

        <section aria-labelledby="set-look" className="group">
          <h2 id="set-look" className="group__title">Appearance</h2>
          <div className="group__card">
            <SettingsLinks />
          </div>
        </section>
      </div>
    </div>
  );
}

/** Friends see this instead of @username. 1–40 characters; empty clears it. */
function DisplayNameRow() {
  const me = useSessionMe();
  const toast = useToast();
  const save = useSaveDisplayName();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const id = useId();
  const errId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const name = value.trim();
    save.mutate(name === '' ? null : name, {
      onSuccess: () => { setEditing(false); toast.show(name === '' ? 'Display name removed' : 'Display name saved'); },
    });
  }

  if (!editing) {
    return (
      <div className="group__row">
        <span>Display name</span>
        <span className="group__row-end">
          <span className="group__value">{me.displayName ?? 'Not set'}</span>
          <Button variant="ghost" compact aria-label="Change display name"
            onClick={() => { setValue(me.displayName ?? ''); save.reset(); setEditing(true); }}>Change</Button>
        </span>
      </div>
    );
  }
  return (
    <div className="group__pad">
      <form className="username-form" onSubmit={submit} noValidate>
        <label htmlFor={id} className="field-label">Display name</label>
        <div className={`text-field${save.isError ? ' has-error' : ''}`}>
          <input id={id} type="text" value={value} maxLength={40} autoComplete="nickname" enterKeyHint="done"
            aria-describedby={save.isError ? errId : undefined} aria-invalid={save.isError ? true : undefined}
            onChange={(e) => { setValue(e.target.value); if (save.isError) save.reset(); }} />
        </div>
        <span className="field-hint">Friends see this instead of @{me.username}. Leave it empty to remove it.</span>
        {save.isError && <p id={errId} role="alert" className="field-error">Couldn't save your display name. Check your connection and try again.</p>}
        <div className="username-form__actions">
          <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

/** Your invite link, one tap from being copied. */
function InviteLinkRow() {
  const code = useInviteCode(false); // fetched when you ask: opening Settings makes no code
  const copy = useCopy();
  const toast = useToast();
  async function onCopy() {
    const c = code.data ?? (await code.refetch()).data;
    if (c) await copy(inviteLink(c));
    else toast.show("Couldn't load your link. Try again.");
  }
  return (
    <div className="group__row">
      <span>Invite link</span>
      <span className="group__row-end">
        <Button variant="ghost" compact aria-label="Copy invite link" disabled={code.isFetching} onClick={() => void onCopy()}>Copy</Button>
      </span>
    </div>
  );
}
