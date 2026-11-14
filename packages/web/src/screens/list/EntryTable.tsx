import { CATEGORY_CONFIG, STATUSES, formatRating, type Entry, type Status } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { effectiveLookupState } from '../../data/entryCache';
import { SAVE_FAILED, saveEntryChange } from '../../data/entryMutations';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';
import { useToast } from '../../design/components/Toast';
import { StatusPill } from '../../design/components/StatusPill';
import { parseRating } from '../../lists/validate';
import { EditableCell } from './EditableCell';
import { LookupNote } from './LookupNote';
import { stagger, type RowActions } from './EntryCards';

/** Moves focus to the same column in the nearest row above/below that has it. */
function onGridKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const target = e.target as HTMLElement;
  const col = target.dataset.nav;
  if (!col) return;
  let row = target.closest('tr')?.[e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling'] ?? null;
  while (row) {
    const next = row.querySelector<HTMLElement>(`[data-nav="${col}"]`);
    if (next) { e.preventDefault(); next.focus(); return; }
    row = row[e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling'];
  }
}

export interface EntryTableProps extends RowActions {
  rows: Entry[];
  label: string;
  showSeasonAvg: boolean;
}

/** PC list: a table whose rating, status and notes edit in place. */
export function EntryTable({ rows, label, showSeasonAvg, ...actions }: EntryTableProps) {
  const first = rows[0];
  if (!first) return null;
  const cfg = CATEGORY_CONFIG[first.category];
  return (
    <div className="table-wrap">
      <table className="entry-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="col-cover">Cover</th>
            <th scope="col" className="col-rating">Rating</th>
            <th scope="col">Title</th>
            {cfg.hasStatus && <th scope="col">Status</th>}
            <th scope="col">Genres</th>
            {cfg.creatorLabel && <th scope="col">{cfg.creatorLabel}</th>}
            {showSeasonAvg && <th scope="col">Season Avg</th>}
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody onKeyDown={onGridKeyDown}>
          {rows.map((e, i) => <TableRow key={e.id} entry={e} index={i} showSeasonAvg={showSeasonAvg} {...actions} />)}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({ entry: e, index, showSeasonAvg, ...actions }: { entry: Entry; index: number; showSeasonAvg: boolean } & RowActions) {
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = CATEGORY_CONFIG[e.category];
  const state = effectiveLookupState(e);
  const editable = state !== 'pending';
  const save = (patch: Partial<Entry>) => void saveEntryChange(qc, e, patch, () => toast.show(SAVE_FAILED));

  return (
    <tr className={state === 'pending' ? 'is-pending rise-in' : 'rise-in'} style={stagger(index)}>
      <td><CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={cfg.square} width={40} className="cover--sm" /></td>
      <td>
        {editable ? (
          <EditableCell
            col="rating" kind="number" label={`Rating for ${e.title}`}
            viewLabel={`Rating for ${e.title}: ${e.rating === null ? 'unrated' : formatRating(e.rating)}`}
            view={<RatingBadge rating={e.rating} size="sm" />}
            initial={e.rating === null ? '' : String(e.rating)}
            validate={parseRating} onSave={(rating) => save({ rating })}
          />
        ) : <RatingBadge rating={e.rating} size="sm" />}
      </td>
      <td>
        <div className="cell-title">
          {state === 'pending' ? <span data-role="title">{e.title}</span> : <Link to={`/entry/${e.id}`} data-nav="title" data-role="title">{e.title}</Link>}
          <LookupNote entry={e} {...actions} />
        </div>
      </td>
      {cfg.hasStatus && (
        <td>
          {editable ? (
            <EditableCell
              col="status" kind="select" label={`Status for ${e.title}`}
              viewLabel={`Status for ${e.title}: ${e.status ?? 'not set'}`}
              view={e.status ? <StatusPill status={e.status} /> : <span className="muted">Set status</span>}
              initial={e.status ?? ''}
              options={[{ value: '', label: 'No status' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
              validate={(raw) => ({ ok: true, value: (raw || null) as Status | null })}
              onSave={(status) => save({ status })}
            />
          ) : (e.status && <StatusPill status={e.status} />)}
        </td>
      )}
      <td className="muted">{e.genres}</td>
      {cfg.creatorLabel && <td>{e.creator}</td>}
      {showSeasonAvg && <td className="muted">{e.seasonAvg === null ? '' : formatRating(e.seasonAvg)}</td>}
      <td>
        {editable ? (
          <EditableCell
            col="notes" kind="text" label={`Notes for ${e.title}`} maxLength={5000}
            viewLabel={`Notes for ${e.title}: ${e.notes || 'empty'}`}
            view={e.notes ? <span className="cell-notes">{e.notes}</span> : <span className="muted">Add a note</span>}
            initial={e.notes}
            validate={(raw) => ({ ok: true, value: raw })} onSave={(notes) => save({ notes })}
          />
        ) : <span className="cell-notes">{e.notes}</span>}
      </td>
    </tr>
  );
}
