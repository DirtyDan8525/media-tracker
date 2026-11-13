import { CATEGORY_CONFIG, STATUSES, formatRating, type Category, type Status } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '../design/components/Button';
import { Sheet } from '../design/components/Sheet';
import { LIST_LABEL } from '../nav';
import type { AddInput } from '../hooks/useAddEntry';

export interface AddEntryProps {
  category: Category;
  onSubmit: (input: AddInput) => void;
  onClose: () => void;
}

const lower = (s: string) => s.toLowerCase();

/** The Add sheet: title, optional creator, a rating slider (can stay unrated) and status chips. */
export function AddEntry({ category, onSubmit, onClose }: AddEntryProps) {
  const cfg = CATEGORY_CONFIG[category];
  const ids = { title: useId(), creator: useId(), rating: useId() };
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const canAdd = title.trim() !== '';

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canAdd) return;
    onSubmit({ title: title.trim(), creator: creator.trim(), rating, status });
    onClose();
  }

  const spotify = category === 'albums' || category === 'songs';
  return (
    <Sheet
      open
      title={`Add to ${LIST_LABEL[category]}`}
      onClose={onClose}
      footer={<Button type="submit" form="add-entry-form" variant="primary" className="btn--block" disabled={!canAdd}>Add</Button>}
    >
      <form id="add-entry-form" className="add-form" onSubmit={submit}>
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
          <div className="field__row">
            <label className="field-label" htmlFor={ids.rating}>Rating</label>
            <output className="rating-readout" htmlFor={ids.rating}>{rating === null ? 'Unrated' : formatRating(rating)}</output>
          </div>
          <input
            id={ids.rating} type="range" className="slider" min={0} max={10} step={0.1} value={rating ?? 0}
            aria-valuetext={rating === null ? 'Unrated' : formatRating(rating)}
            onPointerDown={() => setRating((r) => r ?? 0)}
            onChange={(e) => setRating(Math.round(Number(e.target.value) * 10) / 10)}
          />
          <div className="field__row">
            <span className="field-hint">Or leave it unrated for now.</span>
            {rating !== null && <Button variant="ghost" compact onClick={() => setRating(null)}>Clear rating</Button>}
          </div>
        </div>

        {cfg.hasStatus && (
          <fieldset className="field chips">
            <legend className="field-label">Status</legend>
            <div className="chips__row">
              {STATUSES.map((s) => (
                <Button key={s} variant="chip" active={status === s} onClick={() => setStatus(status === s ? null : s)}>{s}</Button>
              ))}
            </div>
          </fieldset>
        )}
      </form>
    </Sheet>
  );
}
