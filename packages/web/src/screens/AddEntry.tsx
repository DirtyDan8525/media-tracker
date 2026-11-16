import {
  CATEGORY_CONFIG, STATUSES, statusLabel, tierFor, tierRange, tiersFor, type Category, type Status, type Tier,
} from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '../design/components/Button';
import { Sheet } from '../design/components/Sheet';
import { TierPicker } from '../design/components/TierPicker';
import { parseRating } from '../lists/validate';
import { LIST_LABEL } from '../nav';
import { useSessionMe } from '../shell/SessionGate';
import type { AddInput } from '../hooks/useAddEntry';

export interface AddEntryProps {
  category: Category;
  /** `place`: "Add and place it", which opens Compare on the new entry once it is saved. */
  onSubmit: (input: AddInput, opts?: { place?: boolean }) => void;
  onClose: () => void;
}

const lower = (s: string) => s.toLowerCase();

/**
 * The Add sheet: title, optional creator, the list's four tier buttons with an "or type a number"
 * box (either can stay empty: unrated), and status chips. A tapped tier posts `tier`; a typed
 * number posts `rating` and the tier it falls in lights up. With Ask to compare on Both or Only for
 * new ratings, a rated title can also be added and placed (Q15, Q16).
 */
export function AddEntry({ category, onSubmit, onClose }: AddEntryProps) {
  const cfg = CATEGORY_CONFIG[category];
  const me = useSessionMe();
  const tiers = tiersFor(me.settings, category);
  const ranges = ([0, 1, 2, 3] as Tier[]).map((t) => tierRange(tiers, t));
  const ids = { title: useId(), creator: useId(), rating: useId(), ratingErr: useId(), ratingHint: useId() };
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  /** A tapped tier (posts `tier`); cleared by typing a number. */
  const [tapped, setTapped] = useState<Tier | null>(null);
  /** The number box's text; cleared by tapping a tier. */
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const parsed = parseRating(typed);
  const rating = parsed.ok ? parsed.value : null;
  // Typing picks the tier its number falls in; tapping picks that tier.
  const shownTier: Tier | null = rating !== null ? tierFor(rating, tiers) : tapped;
  const canAdd = title.trim() !== '' && parsed.ok;
  const canPlace = canAdd && shownTier !== null
    && (me.settings.compareAsk === 'Both' || me.settings.compareAsk === 'Only for new ratings');

  function submit(place = false) {
    if (!canAdd) return;
    const input: AddInput = { title: title.trim(), creator: creator.trim(), status };
    if (rating !== null) input.rating = rating;
    else if (tapped !== null) input.tier = tapped;
    onSubmit(input, place ? { place: true } : undefined);
    onClose();
  }

  const spotify = category === 'albums' || category === 'songs';
  return (
    <Sheet
      open
      title={`Add to ${LIST_LABEL[category]}`}
      onClose={onClose}
      footer={(
        <div className="add-footer">
          <Button type="submit" form="add-entry-form" variant="primary" className="btn--block" disabled={!canAdd}>Add</Button>
          {canPlace && <Button className="btn--block" onClick={() => submit(true)}>Add and place it</Button>}
        </div>
      )}
    >
      <form id="add-entry-form" className="add-form" onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }}>
        <div className="field">
          <label className="field-label" htmlFor={ids.title}>{cfg.titleLabel}</label>
          <input
            id={ids.title} className="input input--lg" value={title} maxLength={300} autoComplete="off"
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

        <div className="field">
          <span className="field-label">How much did you like it?</span>
          <TierPicker names={tiers.names} ranges={ranges} value={shownTier} label="Tier"
            onPick={(t) => { setTyped(''); setTapped(t === tapped && rating === null ? null : t); }} />
          <label className="field-label" htmlFor={ids.rating}>or type a number</label>
          <input
            id={ids.rating} type="number" className="input" step="any" min={0} max={10} inputMode="decimal"
            value={typed} aria-invalid={parsed.ok ? undefined : true} aria-describedby={parsed.ok ? ids.ratingHint : ids.ratingErr}
            onChange={(e) => { setTyped(e.target.value); setTapped(null); }}
          />
          {parsed.ok
            ? <span id={ids.ratingHint} className="field-hint">Typing a number picks the tier it falls in. Or leave it unrated for now.</span>
            : <span id={ids.ratingErr} role="alert" className="field-error">{parsed.error}</span>}
        </div>

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
      </form>
    </Sheet>
  );
}
