import {
  APP_SETTING_DEFAULTS, COLUMN_IDS, COMPARE_ASK, NAV_WIDTH_RANGE, SEARCH_SCOPE, TEXT_SIZE_STEPS,
  type ApplyKey, type NewPersonDefaults, type NotifyKey,
} from '@media-tracker/shared';
import { useId, useState, type ReactNode } from 'react';
import { useApplyDefault, useSaveSetting } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { SegRadio } from '../../design/components/SegRadio';
import { Sheet } from '../../design/components/Sheet';
import { LIST_LABEL, LIST_ORDER } from '../../nav';
import { NOTIFICATIONS_ENABLED } from '../settings/NotificationsSection';
import { AdminPage, Result, saveError, THEME_NAMES, useFeedback } from './parts';

const BUILT_IN = APP_SETTING_DEFAULTS.defaults;
const NOTIFY_LABELS: Record<NotifyKey, string> = {
  messages: 'Messages', friendRequests: 'Friend requests', comments: 'Comments on my posts', reactions: 'Reactions to my posts', signups: 'New sign-ups waiting',
};

/** /admin/defaults (Dan, 2026-11-19): a default for every per-person setting. Everyone follows it until they change that setting themselves. */
export function DefaultsScreen() {
  return <AdminPage title="Defaults">{(app) => <DefaultsForm initial={app.settings.defaults} people={app.people ?? 0} />}</AdminPage>;
}

interface RowProps {
  label: string;
  /** Resets this row's default(s) to the built-in value. */
  onReset: () => void;
  /** The "Apply to everyone" key; absent for a device-only setting or one with nothing per person to change. */
  apply?: ApplyKey;
  onApply?: (key: ApplyKey, label: string) => void;
  device?: boolean;
  hint?: string;
  children: ReactNode;
}

function Row({ label, onReset, apply, onApply, device, hint, children }: RowProps) {
  return (
    <div className="group__pad stack-10" role="group" aria-label={label}>
      {children}
      {hint && <p className="hint">{hint}</p>}
      {device && <p className="hint">Starting value on new devices. A device that already saved its own keeps it.</p>}
      <div className="admin-actions">
        <Button variant="ghost" compact onClick={onReset} aria-label={`Reset ${label} to built-in`}>Reset to built-in</Button>
        {apply && onApply && <Button compact onClick={() => onApply(apply, label)} aria-label={`Apply ${label} to everyone`}>Apply to everyone</Button>}
      </div>
    </div>
  );
}

function DefaultsForm({ initial, people }: { initial: NewPersonDefaults; people: number }) {
  const save = useSaveSetting();
  const applyMut = useApplyDefault();
  const fb = useFeedback();
  const [d, setD] = useState(initial);
  const [asking, setAsking] = useState<{ key: ApplyKey; label: string } | null>(null);
  const ids = { theme: useId(), navWidth: useId(), chat: useId(), act: useId() };

  /** Saves the change the moment it is made, like the Switches page. */
  async function change(patch: Partial<NewPersonDefaults>, what: string) {
    const next = { ...d, ...patch };
    if (next.lists.length < 1) { fb.fail('Pick at least one list.'); return; }
    const prev = d;
    setD(next);
    try {
      await save.mutateAsync({ key: 'defaults', value: next });
      fb.ok(`${what} saved. People who never changed it follow it now.`);
    } catch (err) {
      setD(prev);
      fb.fail(saveError(err, 'default'));
    }
  }
  async function confirmApply() {
    if (!asking) return;
    try {
      const r = await applyMut.mutateAsync(asking.key);
      fb.ok(`${asking.label} applied to ${r.people} ${r.people === 1 ? 'person' : 'people'}.`);
    } catch (err) {
      fb.fail(saveError(err, 'default'));
    }
    setAsking(null);
  }
  const apply = (key: ApplyKey, label: string) => setAsking({ key, label });
  const resetLists = () => void change({ lists: [...BUILT_IN.lists], animeSeasons: BUILT_IN.animeSeasons, tvSeasons: BUILT_IN.tvSeasons }, 'Lists');

  return (
    <div className="stack-18">
      <p className="friend-note">Everyone follows these for any setting they never changed themselves. "Apply to everyone" also overrides people who did change it.</p>
      <Result fb={fb.fb} />

      <section aria-labelledby="df-rating" className="group">
        <h2 id="df-rating" className="group__title">Rating</h2>
        <div className="group__card">
          <Row label="Ask to compare close ratings" apply="compareAsk" onApply={apply} onReset={() => void change({ compareAsk: BUILT_IN.compareAsk }, 'Rating')}>
            <label className="switch-row">
              <input type="checkbox" role="switch" checked={d.compareAsk === 'Both' || d.compareAsk === 'Only for new ratings'}
                onChange={(e) => void change({ compareAsk: e.target.checked ? COMPARE_ASK[0] : 'Off' }, 'Rating')} />
              <span>Ask me to compare close ratings</span>
            </label>
          </Row>
        </div>
      </section>

      <section aria-labelledby="df-lists" className="group">
        <h2 id="df-lists" className="group__title">Lists</h2>
        <div className="group__card">
          <Row label="Lists on" apply="lists" onApply={apply} onReset={resetLists}>
            <fieldset className="admin-swatches">
              <legend className="admin-field__label">Show these lists</legend>
              {LIST_ORDER.map((c) => (
                <label key={c} className="admin-swatch">
                  <input type="checkbox" checked={d.lists.includes(c)}
                    onChange={(e) => void change({ lists: LIST_ORDER.filter((x) => (x === c ? e.target.checked : d.lists.includes(x))) }, 'Lists')} />
                  {LIST_LABEL[c]}
                </label>
              ))}
            </fieldset>
          </Row>
          <Row label="Anime seasons" apply="animeSeasons" onApply={apply} onReset={() => void change({ animeSeasons: BUILT_IN.animeSeasons }, 'Anime seasons')}>
            <label className="switch-row"><input type="checkbox" role="switch" checked={d.animeSeasons} onChange={(e) => void change({ animeSeasons: e.target.checked }, 'Anime seasons')} /><span>Anime seasons</span></label>
          </Row>
          <Row label="TV seasons" apply="tvSeasons" onApply={apply} onReset={() => void change({ tvSeasons: BUILT_IN.tvSeasons }, 'TV seasons')}>
            <label className="switch-row"><input type="checkbox" role="switch" checked={d.tvSeasons} onChange={(e) => void change({ tvSeasons: e.target.checked }, 'TV seasons')} /><span>TV seasons</span></label>
          </Row>
          <Row label="List order" apply="listOrder" onApply={apply} onReset={() => void change({ listOrder: [] }, 'List order')}
            hint="Follows the order set in Admin, Lists. Applying it clears everyone's own order.">
            <span className="group__value">{d.listOrder.length ? d.listOrder.map((c) => LIST_LABEL[c]).join(', ') : "The admin's order"}</span>
          </Row>
          <Row label="Search" apply="searchScope" onApply={apply} onReset={() => void change({ searchScope: BUILT_IN.searchScope }, 'Search')}>
            <SegRadio label="Where Search looks" value={d.searchScope}
              options={SEARCH_SCOPE.map((v) => ({ value: v, label: v === 'all' ? 'All lists' : 'Only the current list' }))}
              onChange={(v) => void change({ searchScope: v }, 'Search')} />
          </Row>
        </div>
      </section>

      <section aria-labelledby="df-side" className="group">
        <h2 id="df-side" className="group__title">Side bar (on a computer)</h2>
        <div className="group__card">
          <Row label="Side bar side" apply="navSide" onApply={apply} onReset={() => void change({ navSide: BUILT_IN.navSide }, 'Side bar side')}>
            <SegRadio label="Side bar" value={d.navSide} options={[{ value: 'left', label: 'On the left' }, { value: 'right', label: 'On the right' }]}
              onChange={(v) => void change({ navSide: v as 'left' | 'right' }, 'Side bar side')} />
          </Row>
          <Row label="Side bar folded" apply="navCollapsed" onApply={apply} onReset={() => void change({ navCollapsed: BUILT_IN.navCollapsed }, 'Side bar folded')}>
            <label className="switch-row"><input type="checkbox" role="switch" checked={d.navCollapsed} onChange={(e) => void change({ navCollapsed: e.target.checked }, 'Side bar folded')} /><span>Folded to an icon rail</span></label>
          </Row>
          <Row label="Cover viewer" apply="coverViewer" onApply={apply} onReset={() => void change({ coverViewer: BUILT_IN.coverViewer }, 'Cover viewer')}>
            <label className="switch-row"><input type="checkbox" role="switch" checked={d.coverViewer} onChange={(e) => void change({ coverViewer: e.target.checked }, 'Cover viewer')} /><span>Cover viewer</span></label>
          </Row>
          <Row label="Side bar width" device onReset={() => void change({ device: { ...d.device, navWidth: null } }, 'Side bar width')}>
            <div className="admin-field">
              <label htmlFor={ids.navWidth}>Side bar width (px, {NAV_WIDTH_RANGE.min} to {NAV_WIDTH_RANGE.max})</label>
              <input id={ids.navWidth} type="number" min={NAV_WIDTH_RANGE.min} max={NAV_WIDTH_RANGE.max} placeholder="240" defaultValue={d.device.navWidth ?? ''}
                key={d.device.navWidth ?? 'none'}
                onBlur={(e) => {
                  const v = e.target.value.trim() === '' ? null : Number(e.target.value);
                  if (v === d.device.navWidth) return;
                  if (v !== null && !(Number.isInteger(v) && v >= NAV_WIDTH_RANGE.min && v <= NAV_WIDTH_RANGE.max)) { fb.fail(`Side bar width must be ${NAV_WIDTH_RANGE.min} to ${NAV_WIDTH_RANGE.max}.`); return; }
                  void change({ device: { ...d.device, navWidth: v } }, 'Side bar width');
                }} />
            </div>
          </Row>
        </div>
      </section>

      <section aria-labelledby="df-look" className="group">
        <h2 id="df-look" className="group__title">Look</h2>
        <div className="group__card">
          <Row label="Theme" apply="theme" onApply={apply} onReset={() => void change({ theme: BUILT_IN.theme }, 'Theme')}>
            <div className="admin-field">
              <label htmlFor={ids.theme}>Theme</label>
              <select id={ids.theme} value={d.theme} onChange={(e) => void change({ theme: e.target.value }, 'Theme')}>
                {THEME_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </Row>
        </div>
      </section>

      <section aria-labelledby="df-priv" className="group">
        <h2 id="df-priv" className="group__title">Privacy</h2>
        <div className="group__card">
          <Row label="New titles private" onReset={() => void change({ privateByDefault: false }, 'New titles private')} hint="Not a personal setting: it already applies to every new title unless the person chose.">
            <label className="switch-row"><input type="checkbox" role="switch" checked={d.privateByDefault} onChange={(e) => void change({ privateByDefault: e.target.checked }, 'New titles private')} /><span>New titles private</span></label>
          </Row>
          <Row label="Notes private" onReset={() => void change({ notesPrivateByDefault: false }, 'Notes private')} hint="Same: it already applies to every new title unless the person chose.">
            <label className="switch-row"><input type="checkbox" role="switch" checked={d.notesPrivateByDefault} onChange={(e) => void change({ notesPrivateByDefault: e.target.checked }, 'Notes private')} /><span>Notes private</span></label>
          </Row>
        </div>
      </section>

      {NOTIFICATIONS_ENABLED && (
        <section aria-labelledby="df-notify" className="group">
          <h2 id="df-notify" className="group__title">Notifications</h2>
          <div className="group__card">
            <Row label="Notification types" apply="notify" onApply={apply} onReset={() => void change({ notify: { ...BUILT_IN.notify } }, 'Notifications')}>
              {(Object.keys(NOTIFY_LABELS) as NotifyKey[]).map((k) => (
                <label key={k} className="switch-row"><input type="checkbox" role="switch" checked={d.notify[k]} onChange={(e) => void change({ notify: { ...d.notify, [k]: e.target.checked } }, 'Notifications')} /><span>{NOTIFY_LABELS[k]}</span></label>
              ))}
            </Row>
          </div>
        </section>
      )}

      <section aria-labelledby="df-text" className="group">
        <h2 id="df-text" className="group__title">Text size and columns</h2>
        <div className="group__card">
          {([['chatTextSize', 'Chat text size', ids.chat], ['activityTextSize', 'Activity text size', ids.act]] as const).map(([k, label, id]) => (
            <Row key={k} label={label} device onReset={() => void change({ device: { ...d.device, [k]: BUILT_IN.device[k] } }, label)}>
              <div className="admin-field">
                <label htmlFor={id}>{label}</label>
                <select id={id} value={d.device[k]} onChange={(e) => void change({ device: { ...d.device, [k]: Number(e.target.value) } }, label)}>
                  {TEXT_SIZE_STEPS.map((s) => <option key={s} value={s}>{s}%</option>)}
                </select>
              </div>
            </Row>
          ))}
          <Row label="Table column widths" device onReset={() => void change({ device: { ...d.device, columnWidths: {} } }, 'Column widths')}
            hint="Pixels, on every list. Leave a column empty to keep its built-in width.">
            <div className="admin-swatches">
              {COLUMN_IDS.map((c) => (
                <label key={c} className="admin-field">
                  <span className="admin-field__label">{c} width</span>
                  <input type="number" min={48} max={600} aria-label={`${c} column width`} defaultValue={d.device.columnWidths[c] ?? ''} key={`${c}-${d.device.columnWidths[c] ?? ''}`}
                    onBlur={(e) => {
                      const w = e.target.value.trim() === '' ? null : Number(e.target.value);
                      if (w === (d.device.columnWidths[c] ?? null)) return;
                      if (w !== null && !(Number.isInteger(w) && w >= 48 && w <= 600)) { fb.fail('Column widths must be 48 to 600.'); return; }
                      const next = { ...d.device.columnWidths };
                      if (w === null) delete next[c]; else next[c] = w;
                      void change({ device: { ...d.device, columnWidths: next } }, 'Column widths');
                    }} />
                </label>
              ))}
            </div>
          </Row>
        </div>
      </section>

      <Sheet open={asking !== null} title={`Apply ${asking?.label ?? ''} to everyone?`} onClose={() => { if (!applyMut.isPending) setAsking(null); }}
        footer={
          <div className="btn-stack">
            <Button className="btn--big" variant="primary" disabled={applyMut.isPending} onClick={() => void confirmApply()}>Apply to everyone</Button>
            <Button className="btn--big" disabled={applyMut.isPending} onClick={() => setAsking(null)}>Cancel</Button>
          </div>
        }>
        {asking && <p className="hint">This changes {asking.label} for all {people} {people === 1 ? 'person' : 'people'}, including those who changed it.</p>}
      </Sheet>
    </div>
  );
}
