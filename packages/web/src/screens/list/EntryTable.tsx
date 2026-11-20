import { STATUSES, airingOf, formatRating, showsProgress, type Entry, type Status } from '@media-tracker/shared';
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
import { ColumnsMenu, OPTIONAL_COLUMNS, TableFrame, useOptionalColumns, useRowViewer, type ColId, type ColumnDef, type ViewerItem } from './tableKit';
import '../../design/tags.css';
import { backState } from '../../shell/BackButton';
import { listCfg, listLabel, statusText } from '../../lists/registry';

/** Which of the per-list columns this table shows (built-in lists: cover and genres; custom lists: what they were made with). */
interface Look { cover: boolean; genres: boolean; year: boolean; link: boolean; tags: boolean }

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

/** 'Sep 29, 2025' from 'YYYY-MM-DD' (blank when not set). */
function dayText(d: string | null | undefined): string {
  if (!d) return '';
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
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
    releaseDate: e.releaseDate, genres: e.genres, synopsis: e.synopsis, source: e.source, sourceId: e.sourceId, to: `/entry/${e.id}`, state: backState(listLabel(e.category)),
  })), [rows]);
  const viewer = useRowViewer(items);
  const optional = useOptionalColumns(first?.category ?? '');
  if (!first) return null;
  const cfg = listCfg(first.category);
  // Columns with nothing to show on this list are left out, so Notes keeps its room (Dan, 2026-11-17).
  const hasProgress = cfg.hasProgress && rows.some((r) => showsProgress(r, cfg.hasProgress) || (r.progress ?? 0) > 0);
  const withAvg = showSeasonAvg && rows.some((r) => r.seasonAvg != null);
  // A custom list shows the columns it was made with (New list): a typed-in list has no covers; Tags, Year, Genres and Link are its choice.
  const look: Look = {
    cover: !cfg.custom || cfg.lookup !== null, genres: cfg.showGenres, year: cfg.custom && cfg.showYear,
    link: cfg.custom && cfg.showLink, tags: cfg.custom && cfg.showTags,
  };
  const columns: ColumnDef[] = [];
  if (look.cover) columns.push({ id: 'cover', label: 'Cover' });
  columns.push({ id: 'rating', label: 'Rating' }, { id: 'title', label: cfg.custom ? cfg.titleLabel : 'Title' });
  if (cfg.hasStatus) columns.push({ id: 'status', label: 'Status' });
  if (hasProgress) columns.push({ id: 'progress', label: 'Progress' });
  if (look.genres) columns.push({ id: 'genres', label: 'Genres' });
  if (cfg.creatorLabel) columns.push({ id: 'creator', label: cfg.creatorLabel });
  if (look.year) columns.push({ id: 'year', label: 'Year' });
  if (withAvg) columns.push({ id: 'avg', label: 'Season Avg' });
  // Optional columns (Columns menu), after the standard ones and before Notes. Airing is for anime and TV only; on a custom list
  // Tags is one of its own columns (or off), not a choice here.
  const choices = OPTIONAL_COLUMNS.filter((c) => (c.id !== 'airing' || first.category === 'anime' || first.category === 'tv') && !(cfg.custom && c.id === 'tags'));
  const extra = choices.filter((c) => optional.on.includes(c.id));
  const shown = new Set<ColId>(extra.map((c) => c.id));
  if (look.tags) shown.add('tags');
  // Same order as the row's cells: Tags, Link, then the other optional columns.
  if (shown.has('tags')) columns.push({ id: 'tags', label: 'Tags' });
  if (look.link) columns.push({ id: 'link', label: 'Link' });
  columns.push(...extra.filter((c) => c.id !== 'tags'));
  columns.push({ id: 'notes', label: 'Notes' });
  return (
    <>
      <div className="table-tools table-tools--columns"><ColumnsMenu choices={choices} on={optional.on} onToggle={optional.toggle} /></div>
      <TableFrame list={first.category} label={label} columns={columns} viewer={viewer}>
        <tbody onKeyDown={onGridKeyDown}>
          {rows.map((e, i) => <TableRow key={e.id} entry={e} index={i} look={look} showSeasonAvg={withAvg} hasProgress={hasProgress} extra={shown} rowProps={viewer.rowProps(e.id)} {...actions} />)}
        </tbody>
      </TableFrame>
    </>
  );
}

function TableRow({ entry: e, index, look, showSeasonAvg, hasProgress, extra, rowProps, ...actions }: { entry: Entry; index: number; look: Look; showSeasonAvg: boolean; hasProgress: boolean; extra: Set<ColId>; rowProps: HTMLAttributes<HTMLTableRowElement> } & RowActions) {
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = listCfg(e.category);
  const state = effectiveLookupState(e);
  const editable = state !== 'pending';
  const save = (patch: Partial<Entry>) => void saveEntryChange(qc, e, patch, () => toast.show(SAVE_FAILED));

  return (
    <tr className={state === 'pending' ? 'is-pending rise-in' : 'rise-in'} style={stagger(index)} {...rowProps}>
      {look.cover && <td><CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={cfg.square} width={40} className="cover--sm" /></td>}
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
          {state === 'pending' ? <span data-role="title">{e.title}</span> : <Link to={`/entry/${e.id}`} state={backState(listLabel(e.category))} data-nav="title" data-role="title">{e.title}</Link>}
          {e.isPrivate && <PrivateLock />}
          <LookupNote entry={e} {...actions} />
        </div>
      </td>
      {cfg.hasStatus && (
        <td>
          {editable ? (
            <EditableCell
              col="status" kind="select" label={`Status for ${e.title}`}
              viewLabel={`Status for ${e.title}: ${e.status ? statusText(e.status, e.category) : 'not set'}`}
              view={e.status ? <StatusPill status={e.status} category={e.category} /> : <span className="muted">Set status</span>}
              initial={e.status ?? ''}
              options={[{ value: '', label: 'No status' }, ...STATUSES.map((s) => ({ value: s, label: statusText(s, e.category) }))]}
              validate={(raw) => ({ ok: true, value: (raw || null) as Status | null })}
              onSave={(status) => save({ status })}
            />
          ) : (e.status && <StatusPill status={e.status} category={e.category} />)}
        </td>
      )}
      {hasProgress && (
        <td className="col-progress">
          {editable && showsProgress(e, cfg.hasProgress)
            ? <ProgressControl entry={e} />
            : (e.progress ?? 0) > 0 && <span className="muted">{progressText(e.progress!, e.progressTotal)}</span>}
        </td>
      )}
      {look.genres && <td className="muted col-genres" title={e.genres || undefined}>{e.genres}</td>}
      {cfg.creatorLabel && <td className="col-creator" title={e.creator || undefined}>{e.creator}</td>}
      {look.year && <td className="muted col-year">{e.releaseDate.slice(0, 4)}</td>}
      {showSeasonAvg && <td className="muted col-avg">{e.seasonAvg === null ? '' : formatRating(e.seasonAvg)}</td>}
      {extra.has('tags') && (
        <td className="col-tags" title={(e.tags ?? []).join(', ') || undefined}>
          {(e.tags?.length ?? 0) > 0 && <ul className="tags-cell tag-list" aria-label={`Tags for ${e.title}`}>{e.tags!.map((t) => <li key={t} className="tag-chip tag-chip--read">{t}</li>)}</ul>}
        </td>
      )}
      {look.link && (
        <td className="col-link">
          {e.link && <a href={e.link} target="_blank" rel="noopener noreferrer" aria-label={`Open the link for ${e.title} (opens in a new tab)`}>Open ↗</a>}
        </td>
      )}
      {extra.has('started') && <td className="muted col-started">{dayText(e.startedAt)}</td>}
      {extra.has('finished') && <td className="muted col-finished">{dayText(e.finishedAt)}</td>}
      {extra.has('rewatches') && <td className="muted col-rewatches">{(e.rewatches ?? 0) > 0 ? e.rewatches : ''}</td>}
      {extra.has('airing') && <td className="muted col-airing">{airingOf(e) ?? ''}</td>}
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
