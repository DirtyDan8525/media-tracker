import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { Entry } from '@media-tracker/shared';
import { onCompleted } from '../../data/rateOnComplete';
import { SAVE_FAILED, saveEntryChange } from '../../data/entryMutations';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';
import { parseRating } from '../../lists/validate';
import { useCloseCall } from '../sharpen/CloseCallSheet';

/** The sheet that follows setting a title to Completed when it has no rating: "You finished X 🎉 / Rate it now?". */
export function RateOnCompleteHost() {
  const qc = useQueryClient();
  const toast = useToast();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { ask: askClose, element: closeCallSheet } = useCloseCall();

  useEffect(() => onCompleted((e) => { setEntry(e); setValue(''); setError(''); }), []);

  async function save(ev?: FormEvent) {
    ev?.preventDefault();
    if (!entry || busy) return;
    const p = parseRating(value);
    if (!p.ok || p.value === null) { setError(p.ok ? 'Type a rating, or choose Later.' : p.error); return; }
    setBusy(true);
    // The normal rating save path: a typed number, then the close-call check.
    const saved = await saveEntryChange(qc, entry, { rating: p.value }, () => toast.show(SAVE_FAILED));
    setBusy(false);
    if (!saved) return;
    setEntry(null);
    if (saved.rating !== null) void askClose(saved.category, saved.id);
  }

  return (
    <>
      <Sheet
        open={entry !== null} title={entry ? `You finished ${entry.title} 🎉` : ''} onClose={() => setEntry(null)}
        footer={(
          <>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>Save rating</Button>
            <Button onClick={() => setEntry(null)}>Later</Button>
          </>
        )}
      >
        <form onSubmit={(e) => void save(e)}>
          <p className="field-hint">Rate it now?</p>
          <label className="field-label" htmlFor="rate-on-complete">Rating</label>
          <input
            id="rate-on-complete" className="input" type="number" inputMode="decimal" step="any" placeholder="Unrated" data-autofocus
            value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? 'rate-on-complete-err' : undefined}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
          />
          {error && <p id="rate-on-complete-err" className="field-error" role="alert">{error}</p>}
        </form>
      </Sheet>
      {closeCallSheet}
    </>
  );
}
