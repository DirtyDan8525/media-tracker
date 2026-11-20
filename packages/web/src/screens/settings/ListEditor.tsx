/**
 * New list / Edit list (Phase 7 wireframe, docs/design/mockups/Phase7.wf.html section 3). Opened from Settings → Tabs
 * ("+ New list", or a list's Edit) and from the phone's More ("New list"). Columns can be changed later.
 */
import {
  CUSTOM_LIST_CREATOR_MAX, CUSTOM_LIST_NAME_MAX, CUSTOM_LIST_NOUN_MAX, NEW_LIST_DEFAULTS, SEARCH_SOURCES, SEARCH_SOURCE_LABEL,
  isOneEmoji, validateCustomList, type CustomList, type CustomListInput, type SearchSource, type StatusWords,
} from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useAppSettings } from '../../data/appSettings';
import { CUSTOM_LISTS_MAX, LIMIT_TEXT, listErrorText, useCreateList, useEditList } from '../../data/customLists';
import { Button } from '../../design/components/Button';
import { useToast } from '../../design/components/Toast';
import { PageHeader } from '../../shell/PageHeader';
import { useSessionMe } from '../../shell/SessionGate';
import { DeleteListSheet } from './DeleteListSheet';
import '../../design/settings.css';

/** Where Settings → Tabs lives (the More screen's note links here). */
export const SETTINGS_TABS_PATH = '/settings#tabs';
export const NEW_LIST_PATH = '/settings/lists/new';
export const editListPath = (l: Pick<CustomList, 'id'>) => `/settings/lists/${encodeURIComponent(l.id)}`;

/** The status word choices, in the wireframe's order. */
const WORDS: { value: StatusWords; label: string }[] = [
  { value: 'try', label: 'Want to try / Been' },
  { value: 'watch', label: 'Watch' },
  { value: 'read', label: 'Read' },
  { value: 'play', label: 'Play' },
];

export function NewListScreen() {
  const me = useSessionMe();
  const { features } = useAppSettings();
  if (!features.customLists) return <Navigate to="/settings" replace />;
  if (me.customLists.length >= CUSTOM_LISTS_MAX) return <Limit />;
  return <ListEditor />;
}

export function EditListScreen() {
  const { id } = useParams();
  const me = useSessionMe();
  const list = me.customLists.find((l) => l.id === id);
  if (!list) return <Navigate to={SETTINGS_TABS_PATH} replace />;
  return <ListEditor key={list.id} list={list} />;
}

function Limit() {
  return (
    <div className="screen">
      <PageHeader title="New list" backTo={SETTINGS_TABS_PATH} backUsesHistory />
      <div className="screen__body"><p className="hint" role="status">{LIMIT_TEXT}</p></div>
    </div>
  );
}

function ListEditor({ list }: { list?: CustomList }) {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateList();
  const edit = useEditList();
  const saving = create.isPending || edit.isPending;
  const start: CustomListInput = list ? { ...list } : { ...NEW_LIST_DEFAULTS };
  const [v, setV] = useState<CustomListInput>(start);
  /** The second line is on when it has a name (or was just switched on). */
  const [second, setSecond] = useState(list ? list.creatorLabel !== null : false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const set = <K extends keyof CustomListInput>(k: K, value: CustomListInput[K]) => { setV((p) => ({ ...p, [k]: value })); setError(null); };
  const ids = { name: useId(), noun: useId(), nounHint: useId(), icon: useId(), iconHint: useId(), second: useId(), err: useId() };

  const body: CustomListInput = { ...v, creatorLabel: second ? (v.creatorLabel ?? '').trim() || null : null };
  const iconOk = isOneEmoji(v.icon.trim());
  const nounShown = v.noun.trim() || 'item';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (second && !body.creatorLabel) { setError('Name the second line, or untick it.'); return; }
    const checked = validateCustomList({ ...body, icon: body.icon.trim() }, list ? 'patch' : 'create');
    if (!checked.ok) {
      setError(checked.error === 'name' ? `Give the list a name (up to ${CUSTOM_LIST_NAME_MAX} characters).`
        : checked.error === 'noun' ? `Say what one item is (up to ${CUSTOM_LIST_NOUN_MAX} characters).`
          : checked.error === 'icon' ? 'The icon must be one emoji, or empty.'
            : "Something in the form isn't right.");
      return;
    }
    try {
      if (list) {
        await edit.mutateAsync({ id: list.id, patch: checked.value });
        toast.show('List saved');
        navigate(-1);
      } else {
        const { list: made } = await create.mutateAsync(checked.value as CustomListInput);
        toast.show(`${made.name} made`);
        navigate(`/list/${made.key}`, { replace: true });
      }
    } catch (err) {
      setError(listErrorText(err));
    }
  }

  const check = (k: 'showTags' | 'showYear' | 'showGenres' | 'showProgress' | 'showLink' | 'hasStatus', label: string, hint?: string) => (
    <label className="list-editor__check">
      <input type="checkbox" checked={v[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>{label}{hint && <span className="field-label__opt"> {hint}</span>}</span>
    </label>
  );

  return (
    <div className="screen">
      <PageHeader title={list ? 'Edit list' : 'New list'} backTo={SETTINGS_TABS_PATH} backUsesHistory />
      <form className="screen__body stack-18 list-editor" onSubmit={(e) => void submit(e)} noValidate aria-describedby={error ? ids.err : undefined}>
        <div className="group__card group__pad stack-10">
          <div className="field">
            <label className="field-label" htmlFor={ids.name}>Name</label>
            <input id={ids.name} className="input" data-autofocus value={v.name} maxLength={CUSTOM_LIST_NAME_MAX} autoComplete="off"
              placeholder="Restaurants" onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={ids.noun}>One item is a…</label>
            <input id={ids.noun} className="input" value={v.noun} maxLength={CUSTOM_LIST_NOUN_MAX} autoComplete="off"
              placeholder="restaurant" aria-describedby={ids.nounHint} onChange={(e) => set('noun', e.target.value)} />
            <span id={ids.nounHint} className="field-hint">The Add button says “Add {nounShown}”.</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={ids.icon}>Icon <span className="field-label__opt">(optional)</span></label>
            <input id={ids.icon} className="input list-editor__icon" value={v.icon} maxLength={32} autoComplete="off" placeholder="🍜"
              aria-invalid={iconOk ? undefined : true} aria-describedby={ids.iconHint} onChange={(e) => set('icon', e.target.value)} />
            <span id={ids.iconHint} className="field-hint">{iconOk ? 'One emoji, shown beside the name.' : 'Use one emoji, or leave it empty.'}</span>
          </div>
        </div>

        <fieldset className="group">
          <legend className="group__title">Columns</legend>
          <div className="group__card group__pad stack-10">
            <div className="list-editor__second">
              <label className="list-editor__check">
                <input type="checkbox" checked={second} onChange={(e) => { setSecond(e.target.checked); setError(null); }} />
                <span>Second line <span className="field-label__opt">(like Studio / Artist)</span></span>
              </label>
              {second && (
                <span className="list-editor__second-name">
                  <label htmlFor={ids.second}>called</label>
                  <input id={ids.second} className="input" value={v.creatorLabel ?? ''} maxLength={CUSTOM_LIST_CREATOR_MAX} autoComplete="off"
                    placeholder="Cuisine" onChange={(e) => set('creatorLabel', e.target.value)} />
                </span>
              )}
            </div>
            <div className="stack-6">
              {check('hasStatus', 'Status')}
              {v.hasStatus && (
                <div className="chips__row" role="radiogroup" aria-label="Status words">
                  {WORDS.map((w) => (
                    <Button key={w.value} variant="chip" role="radio" aria-checked={v.statusWords === w.value} aria-pressed={undefined}
                      active={v.statusWords === w.value} onClick={() => set('statusWords', w.value)}>{w.label}</Button>
                  ))}
                </div>
              )}
            </div>
            <div className="list-editor__checks">
              {check('showTags', 'Tags')}
              {check('showYear', 'Year')}
              {check('showGenres', 'Genres')}
              {check('showProgress', 'Progress', '(episodes/chapters)')}
            </div>
            {check('showLink', 'Link', '(a website or map link per item)')}
          </div>
        </fieldset>

        <fieldset className="group">
          <legend className="group__title">Search when adding</legend>
          <div className="group__card group__pad stack-6">
            <div className="chips__row" role="radiogroup" aria-label="Search when adding">
              <Button variant="chip" role="radio" aria-checked={v.searchSource === null} aria-pressed={undefined} active={v.searchSource === null}
                onClick={() => set('searchSource', null)}>None — type it in</Button>
              {SEARCH_SOURCES.map((s: SearchSource) => (
                <Button key={s} variant="chip" role="radio" aria-checked={v.searchSource === s} aria-pressed={undefined} active={v.searchSource === s}
                  onClick={() => set('searchSource', s)}>{SEARCH_SOURCE_LABEL[s]}</Button>
              ))}
            </div>
            <p className="hint">{v.searchSource === null
              ? 'Add saves what you type. Nothing is looked up.'
              : `Add looks the ${v.noun.trim() || 'item'} up like ${SEARCH_SOURCE_LABEL[v.searchSource]} does: cover, details and all.`}</p>
          </div>
        </fieldset>

        {error && <p id={ids.err} role="alert" className="field-error">{error}</p>}
        <div className="list-editor__actions">
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : list ? 'Save' : 'Create list'}</Button>
          {list && <Button variant="ghost" onClick={() => setDeleting(true)}>Delete list…</Button>}
        </div>
        <p className="hint">Columns can be changed later.</p>
      </form>
      {list && deleting && (
        <DeleteListSheet list={list} onClose={() => setDeleting(false)} onDeleted={() => navigate(SETTINGS_TABS_PATH, { replace: true })} />
      )}
    </div>
  );
}
