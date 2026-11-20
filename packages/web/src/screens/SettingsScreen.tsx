import { SEARCH_SCOPE } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import type { CustomList } from '@media-tracker/shared';
import { inviteLink, useCopy, useInviteCode, useSaveDisplayName } from '../data/social';
import { SETTINGS_SAVE_ERROR, useSaveSettings } from '../data/useMe';
import { formatQuietUntil, useQuiet, useSetQuiet } from '../data/quiet';
import { Button } from '../design/components/Button';
import { useToast } from '../design/components/Toast';
import { useAppSettings } from '../data/appSettings';
import { useIsWide } from '../hooks';
import { tabSwitches } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { ExportRow } from './settings/ExportRow';
import { FillDetailsRow } from './settings/FillDetailsRow';
import { CompareOptions } from './settings/CompareOptions';
import { NOTIFICATIONS_ENABLED, NotificationsSection } from './settings/NotificationsSection';
import { SettingsLinks } from './settings/SettingsLinks';
import { SideBarRows } from './settings/SideBarRows';
import { TagsLink } from './settings/TagsLink';
import { PublicLinkRow } from './settings/PublicLinkRow';
import { useSessionMe } from '../shell/SessionGate';
import { UsernameForm } from './UsernameForm';
import { DeleteListSheet } from './settings/DeleteListSheet';
import { editListPath } from './settings/ListEditor';
import { NewListButton } from './settings/NewListButton';
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
  const app = useAppSettings();
  const wide = useIsWide();
  const quiet = useQuiet(me.settings.quietUntil);
  const setQuiet = useSetQuiet();

  function toggle(key: string, on: boolean) {
    save.mutate({ tabs: { [key]: on } });
  }
  const [deleting, setDeleting] = useState<CustomList | null>(null);
  // More → "go to Settings" links to /settings#tabs: bring the Tabs section into view and put focus on its heading.
  const { hash } = useLocation();
  const tabsRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (hash !== '#tabs') return;
    tabsRef.current?.scrollIntoView?.({ block: 'start' });
    tabsRef.current?.focus({ preventScroll: true });
  }, [hash]);

  return (
    <div className="screen">
      <PageHeader title="Settings" backTo="/profile" backUsesHistory />
      <div className="screen__body stack-18 wide-cols">
        <section aria-labelledby="set-tabs" className="group" id="tabs">
          <h2 id="set-tabs" className="group__title" ref={tabsRef} tabIndex={-1}>Tabs</h2>
          <div className="group__card switch-grid">
            {tabSwitches(app.lists, me.settings.listOrder, me.customLists).map(({ key, label, custom }) => {
              const sw = (
                <label key={key} className="switch-row">
                  <input type="checkbox" role="switch" checked={me.settings.tabs[key] !== false}
                    onChange={(e) => toggle(key, e.target.checked)} />
                  <span>{label}</span>
                </label>
              );
              const list = custom ? me.customLists.find((l) => l.key === key) : undefined;
              if (!list) return sw;
              // Your own lists: Edit and Delete beside the switch.
              return (
                <div key={key} className="switch-row-wrap">
                  {sw}
                  <span className="switch-row__actions">
                    <Link to={editListPath(list)} className="btn btn--ghost btn--compact" aria-label={`Edit ${list.name}`}>Edit</Link>
                    <Button variant="ghost" compact aria-label={`Delete ${list.name}`} onClick={() => setDeleting(list)}>Delete</Button>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="tabs-new-list"><NewListButton /></div>
        </section>
        {deleting && <DeleteListSheet list={deleting} onClose={() => setDeleting(null)} />}

        {wide && (
          <section aria-labelledby="set-pc" className="group">
            <h2 id="set-pc" className="group__title">On this computer</h2>
            <div className="group__card group__pad stack-10">
              <SegRadio label="Side bar" value={me.settings.nav.side}
                options={[{ value: 'left', label: 'On the left' }, { value: 'right', label: 'On the right' }]}
                onChange={(v) => { if (me.settings.nav.side !== v) save.mutate({ nav: { side: v as 'left' | 'right' } }); }} />
              <SideBarRows />
              <label className="switch-row" id="cover-viewer">
                <input type="checkbox" role="switch" checked={me.settings.coverViewer}
                  onChange={(e) => save.mutate({ coverViewer: e.target.checked })} />
                <span>Cover viewer</span>
              </label>
              <p className="hint">Point at a row in a list (or click it) to see its cover large, with the details and its Spotify, trailer or YouTube buttons, beside the table.</p>
            </div>
          </section>
        )}

        {app.features.feed && (
          <section aria-labelledby="set-quiet" className="group">
            <h2 id="set-quiet" className="group__title">Activity</h2>
            <div className="group__card group__pad stack-10">
              <label className="switch-row" id="quiet-mode">
                <input type="checkbox" role="switch" checked={quiet.on} onChange={(e) => setQuiet(e.target.checked)} />
                <span>Quiet mode: don't post my changes to Activity</span>
              </label>
              <p className="hint">
                {quiet.until ? `On until ${formatQuietUntil(quiet.until)}` : 'Nothing you add, rate or change is posted to Activity. It turns itself off after 24 hours.'}
              </p>
            </div>
          </section>
        )}

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
            <TagsLink />
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
            <PublicLinkRow />
          </div>
        </section>

        {NOTIFICATIONS_ENABLED && <NotificationsSection />}

        {app.features.closeCalls && (
          <section aria-labelledby="set-ratings" className="group">
            <h2 id="set-ratings" className="group__title">Ratings</h2>
            <CompareOptions />
          </section>
        )}

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
