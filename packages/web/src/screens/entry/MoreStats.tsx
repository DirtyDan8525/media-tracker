import { REWATCHES_MAX, airingOf, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { SAVE_FAILED, saveEntryChange } from '../../data/entryMutations';
import { Icon } from '../../design/components/Icon';
import { useToast } from '../../design/components/Toast';
import '../../design/tags.css';

const MIN_DAY = '1900-01-01';

/** One editable day: a date box that saves when it holds a whole date, and a Clear button. */
function DayField({ label, value, onSave }: { label: string; value: string | null; onSave: (v: string | null) => void }) {
  const id = useId();
  return (
    <div className="stat-row">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="stat-row__end">
        <input id={id} type="date" className="input stat-row__date" min={MIN_DAY} value={value ?? ''}
          onChange={(e) => { const v = e.target.value; if (v !== (value ?? '')) onSave(v === '' ? null : v); }} />
        {value && <button type="button" className="btn btn--ghost btn--compact" aria-label={`Clear ${label.toLowerCase()} date`} onClick={() => onSave(null)}>Clear</button>}
      </div>
    </div>
  );
}

/** "More stats" at the bottom of the title page, closed by default: Started, Finished, Rewatches and (TV, when its lookup said) Airing. */
export function MoreStats({ entry }: { entry: Entry }) {
  const qc = useQueryClient();
  const toast = useToast();
  const rewId = useId();
  const save = (patch: Partial<Entry>) => void saveEntryChange(qc, entry, patch, () => toast.show(SAVE_FAILED));
  const rewatches = entry.rewatches ?? 0;
  const airing = airingOf(entry);
  const setRewatches = (n: number) => { if (n >= 0 && n <= REWATCHES_MAX && n !== rewatches) save({ rewatches: n }); };
  return (
    <details className="detail__section detail__more more-stats" aria-label="More stats">
      <summary className="detail__more-summary"><span>More stats</span><Icon name="chevron-down" size={18} /></summary>
      <div className="detail__edit">
        <DayField label="Started" value={entry.startedAt ?? null} onSave={(startedAt) => save({ startedAt })} />
        <DayField label="Finished" value={entry.finishedAt ?? null} onSave={(finishedAt) => save({ finishedAt })} />
        <div className="stat-row" role="group" aria-labelledby={rewId}>
          <span className="field-label" id={rewId}>Rewatches</span>
          <div className="stat-row__end stepper">
            <button type="button" className="btn btn--secondary btn--compact" aria-label="Fewer rewatches" disabled={rewatches <= 0} onClick={() => setRewatches(rewatches - 1)}>−</button>
            <span className="stepper__n" aria-live="polite">{rewatches}</span>
            <button type="button" className="btn btn--secondary btn--compact" aria-label="More rewatches" disabled={rewatches >= REWATCHES_MAX} onClick={() => setRewatches(rewatches + 1)}>+</button>
          </div>
        </div>
        {airing && (
          <div className="stat-row">
            <span className="field-label">Airing</span>
            <span className="stat-row__end">{airing}</span>
          </div>
        )}
      </div>
    </details>
  );
}
