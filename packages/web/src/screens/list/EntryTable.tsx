import { CATEGORY_CONFIG, PROGRESS_CATEGORIES, STATUSES, formatRating, showsProgress, statusLabel, type Entry, type Status } from '@media-tracker/shared';
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
import { ProgressControl, progressText } from './ProgressControl';
import { LookupNote } from './LookupNote';
import { PrivateLock } from './PrivateLock';
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

/** Fixed column widths in px (mirrors lists.css); Notes takes the rest but never less than NOTES_MIN. */
export const COL_WIDTHS = { cover: 56, rating: 72, title: 220, status: 132, progress: 196, genres: 140, creator: 140, avg: 80 } as const;
const NOTES_MIN = 140;
export function tableMinWidth(cols: (keyof typeof COL_WIDTHS)[]): number {
  return cols.reduce((n, c) => n + COL_WIDTHS[c], NOTES_MIN);
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
  // Columns with nothing to show on this list are left out, so Notes keeps its room (Dan, 2026-11-17).
  const hasProgress = PROGRESS_CATEGORIES.includes(first.category) && rows.some((r) => showsProgress(r) || (r.progress ?? 0) > 0);
  const cols: (keyof typeof COL_WIDTHS)[] = ['cover', 'rating', 'title', 'genres'];
  if (cfg.hasStatus) cols.push('status');
  if (hasProgress) cols.push('progress');
  if (cfg.creatorLabel) cols.push('creator');
  const withAvg = showSeasonAvg && rows.some((r) => r.seasonAvg != null);
  if (withAvg) cols.push('avg');
  return (
    <div className="table-wrap">
      <table className="entry-table" aria-label={label} style={{ minWidth: tableMinWidth(cols) }}>
        <thead>
          <tr>
            <th scope="col" className="col-cover">Cover</th>
            <th scope="col" className="col-rating">Rating</th>
            <th scope="col" className="col-title">Title</th>
            {cfg.hasStatus && <th scope="col" className="col-status">Status</th>}
            {hasProgress && <th scope="col" className="col-progress">Progress</th>}
            <th scope="col" className="col-genres">Genres</th>
            {cfg.creatorLabel && <th scope="col" className="col-creator">{cfg.creatorLabel}</th>}
            {withAvg && <th scope="col" className="col-avg">Season Avg</th>}
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody onKeyDown={onGridKeyDown}>
          {rows.map((e, i) => <TableRow key={e.id} entry={e} index={i} showSeasonAvg={withAvg} hasProgress={hasProgress} {...actions} />)}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({ entry: e, index, showSeasonAvg, hasProgress, ...actions }: { entry: Entry; index: number; showSeasonAvg: boolean; hasProgress: boolean } & RowActions) {
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
          {e.isPrivate && <PrivateLock />}
          <LookupNote entry={e} {...actions} />
        </div>
      </td>
      {cfg.hasStatus && (
        <td>
          {editable ? (
            <EditableCell
              col="status" kind="select" label={`Status for ${e.title}`}
              viewLabel={`Status for ${e.title}: ${e.status ? statusLabel(e.status, e.category) : 'not set'}`}
              view={e.status ? <StatusPill status={e.status} category={e.category} /> : <span className="muted">Set status</span>}
              initial={e.status ?? ''}
              options={[{ value: '', label: 'No status' }, ...STATUSES.map((s) => ({ value: s, label: statusLabel(s, e.category) }))]}
              validate={(raw) => ({ ok: true, value: (raw || null) as Status | null })}
              onSave={(status) => save({ status })}
            />
          ) : (e.status && <StatusPill status={e.status} category={e.category} />)}
        </td>
      )}
      {hasProgress && (
        <td className="col-progress">
          {editable && showsProgress(e)
            ? <ProgressControl entry={e} />
            : (e.progress ?? 0) > 0 && <span className="muted">{progressText(e.progress!, e.progressTotal)}</span>}
        </td>
      )}
      <td className="muted col-genres" title={e.genres || undefined}>{e.genres}</td>
      {cfg.creatorLabel && <td className="col-creator" title={e.creator || undefined}>{e.creator}</td>}
      {showSeasonAvg && <td className="muted col-avg">{e.seasonAvg === null ? '' : formatRating(e.seasonAvg)}</td>}
      <td>
        {editable ? (
          <EditableCell
            col="notes" kind="text" label={`Notes for ${e.title}`} maxLength={5000}
            viewLabel={`Notes for ${e.title}: ${e.notes || 'empty'}`}
            hoverText={e.notes}
            view={e.notes ? <span className="cell-notes">{e.notes}</span> : <span className="muted">Add a note</span>}
            initial={e.notes}
            validate={(raw) => ({ ok: true, value: raw })} onSave={(notes) => save({ notes })}
          />
        ) : <span className="cell-notes" title={e.notes || undefined}>{e.notes}</span>}
      </td>
    </tr>
  );
}
