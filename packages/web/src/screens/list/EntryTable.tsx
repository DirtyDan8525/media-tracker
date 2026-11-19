import { CATEGORY_CONFIG, PROGRESS_CATEGORIES, STATUSES, formatRating, showsProgress, statusLabel, type Entry, type Status } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, type HTMLAttributes, type KeyboardEvent } from 'react';
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
import { TableFrame, useRowViewer, type ColumnDef, type ViewerItem } from './tableKit';
import { LIST_LABEL } from '../../nav';
import { backState } from '../../shell/BackButton';

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

/** PC list: a table whose rating, status and notes edit in place. Columns resize; a click on a row opens the cover viewer. */
export function EntryTable({ rows, label, showSeasonAvg, ...actions }: EntryTableProps) {
  const first = rows[0];
  const items = useMemo<ViewerItem[]>(() => rows.map((e) => ({
    id: e.id, title: e.title, category: e.category, coverUrl: e.coverUrl, rating: e.rating, status: e.status, creator: e.creator,
    releaseDate: e.releaseDate, genres: e.genres, synopsis: e.synopsis, to: `/entry/${e.id}`, state: backState(LIST_LABEL[e.category]),
  })), [rows]);
  const viewer = useRowViewer(items);
  if (!first) return null;
  const cfg = CATEGORY_CONFIG[first.category];
  // Columns with nothing to show on this list are left out, so Notes keeps its room (Dan, 2026-11-17).
  const hasProgress = PROGRESS_CATEGORIES.includes(first.category) && rows.some((r) => showsProgress(r) || (r.progress ?? 0) > 0);
  const withAvg = showSeasonAvg && rows.some((r) => r.seasonAvg != null);
  const columns: ColumnDef[] = [{ id: 'cover', label: 'Cover' }, { id: 'rating', label: 'Rating' }, { id: 'title', label: 'Title' }];
  if (cfg.hasStatus) columns.push({ id: 'status', label: 'Status' });
  if (hasProgress) columns.push({ id: 'progress', label: 'Progress' });
  columns.push({ id: 'genres', label: 'Genres' });
  if (cfg.creatorLabel) columns.push({ id: 'creator', label: cfg.creatorLabel });
  if (withAvg) columns.push({ id: 'avg', label: 'Season Avg' });
  columns.push({ id: 'notes', label: 'Notes' });
  return (
    <TableFrame list={first.category} label={label} columns={columns} viewer={viewer}>
      <tbody onKeyDown={onGridKeyDown}>
        {rows.map((e, i) => <TableRow key={e.id} entry={e} index={i} showSeasonAvg={withAvg} hasProgress={hasProgress} rowProps={viewer.rowProps(e.id)} {...actions} />)}
      </tbody>
    </TableFrame>
  );
}

function TableRow({ entry: e, index, showSeasonAvg, hasProgress, rowProps, ...actions }: { entry: Entry; index: number; showSeasonAvg: boolean; hasProgress: boolean; rowProps: HTMLAttributes<HTMLTableRowElement> } & RowActions) {
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = CATEGORY_CONFIG[e.category];
  const state = effectiveLookupState(e);
  const editable = state !== 'pending';
  const save = (patch: Partial<Entry>) => void saveEntryChange(qc, e, patch, () => toast.show(SAVE_FAILED));

  return (
    <tr className={state === 'pending' ? 'is-pending rise-in' : 'rise-in'} style={stagger(index)} {...rowProps}>
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
          {state === 'pending' ? <span data-role="title">{e.title}</span> : <Link to={`/entry/${e.id}`} state={backState(LIST_LABEL[e.category])} data-nav="title" data-role="title">{e.title}</Link>}
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
