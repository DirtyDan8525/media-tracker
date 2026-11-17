import { CATEGORY_CONFIG, PLAN_STATUS, STATUSES, statusLabel, type Category, type Status } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '../design/components/Button';
import { Sheet } from '../design/components/Sheet';
import { parseRating } from '../lists/validate';
import { enabledLists, LIST_LABEL } from '../nav';
import { ListMenu } from '../shell/ListMenu';
import { useSessionMe } from '../shell/SessionGate';
import type { AddInput } from '../hooks/useAddEntry';

export interface AddEntryProps {
  category: Category;
  /** After it is saved, the list asks about close ratings (Ruling N6). */
  onSubmit: (input: AddInput) => void;
  onClose: () => void;
}

const lower = (s: string) => s.toLowerCase();

/**
 * The Add sheet (AddRate board): title, optional creator, a Rating number box (empty: unrated) and
 * status chips. The number is the truth (Ruling N1); a Plan to watch title has no rating field (N8).
 */
export function AddEntry({ category: initial, onSubmit, onClose }: AddEntryProps) {
  const me = useSessionMe();
  /** "Add to": starts on the current list; the field label and status words follow it. */
  const [category, setCategory] = useState<Category>(initial);
  const cfg = CATEGORY_CONFIG[category];
  const lists = enabledLists(me.settings);
  const ids = { title: useId(), creator: useId(), notes: useId(), rating: useId(), ratingErr: useId(), ratingHint: useId() };
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [notes, setNotes] = useState('');
  /** The number box's text. */
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const planned = cfg.hasStatus && status === PLAN_STATUS;
  const parsed = parseRating(planned ? '' : typed);
  const rating = parsed.ok ? parsed.value : null;
  const canAdd = title.trim() !== '' && parsed.ok;

  function submit() {
    if (!canAdd) return;
    const input: AddInput = { title: title.trim(), creator: cfg.creatorLabel ? creator.trim() : '', status: cfg.hasStatus ? status : null, category };
    if (rating !== null) input.rating = rating;
    if (notes.trim()) input.notes = notes.trim();
    onSubmit(input);
    onClose();
  }

  const spotify = category === 'albums' || category === 'songs';
  return (
    <Sheet
      open
      title="Add"
      onClose={onClose}
      footer={(
        <div className="add-footer">
          <Button type="submit" form="add-entry-form" variant="primary" className="btn--block" disabled={!canAdd}>Add</Button>
        </div>
      )}
    >
      <form id="add-entry-form" className="add-form" onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }}>
        <div className="field">
          <span className="field-label">Add to</span>
          <ListMenu
            lists={lists.includes(category) ? lists : [category, ...lists]} value={category} menuLabel="Add to" triggerLabel={`Add to ${LIST_LABEL[category]}`}
            onChoose={(c) => { setCategory(c); setStatus(null); }} field
          >
            {LIST_LABEL[category]}
          </ListMenu>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={ids.title}>{cfg.titleLabel}</label>
          <input
            id={ids.title} data-autofocus className="input input--lg" value={title} maxLength={300} autoComplete="off"
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="field-hint">
            Typos are fine. The official title and cover{cfg.creatorLabel ? ` and ${lower(cfg.creatorLabel)}` : ''} fill in for you.
            {spotify && ' You can also paste a Spotify link.'}
          </span>
        </div>

        {cfg.creatorLabel && (
          <div className="field">
            <label className="field-label" htmlFor={ids.creator}>
              {cfg.creatorLabel} <span className="field-label__opt">(optional)</span>
            </label>
            <input
              id={ids.creator} className="input" value={creator} maxLength={300} autoComplete="off"
              placeholder={cfg.creatorIsSearchHint ? 'Helps find the right one' : 'Leave blank to look it up'}
              onChange={(e) => setCreator(e.target.value)}
            />
          </div>
        )}

        {!planned && (
          <div className="field">
            <label className="field-label" htmlFor={ids.rating}>Rating</label>
            <input
              id={ids.rating} type="number" className="input" step="any" min={0} max={10} inputMode="decimal"
              value={typed} aria-invalid={parsed.ok ? undefined : true} aria-describedby={parsed.ok ? ids.ratingHint : ids.ratingErr}
              onChange={(e) => setTyped(e.target.value)}
            />
            {parsed.ok
              ? <span id={ids.ratingHint} className="field-hint">0 to 10, one decimal. Leave empty to skip.</span>
              : <span id={ids.ratingErr} role="alert" className="field-error">{parsed.error}</span>}
          </div>
        )}

        {cfg.hasStatus && (
          <fieldset className="field chips">
            <legend className="field-label">Status</legend>
            <div className="chips__row">
              {STATUSES.map((s) => (
                <Button key={s} variant="chip" active={status === s} onClick={() => setStatus(status === s ? null : s)}>{statusLabel(s, category)}</Button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="field">
          <label className="field-label" htmlFor={ids.notes}>
            Note <span className="field-label__opt">(optional)</span>
          </label>
          <textarea id={ids.notes} className="input" rows={2} maxLength={5000} value={notes}
            placeholder="Anything you want to remember" onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </Sheet>
  );
}
