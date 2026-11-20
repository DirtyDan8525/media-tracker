import { type Category, type SourceId, type Status } from '@media-tracker/shared';
import { createContext, useCallback, useEffect, useId, useContext, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '../../design/components/Icon';
import { CoverViewer } from './CoverViewer';
import { getDeviceDefaults } from '../../data/deviceDefaults';

/* ---------- Column widths ---------- */

export type ColId = 'cover' | 'rating' | 'title' | 'status' | 'progress' | 'genres' | 'creator' | 'avg' | 'notes'
  | 'tags' | 'started' | 'finished' | 'rewatches' | 'airing';

/**
 * Default column widths in px: each is as narrow as its content allows (Progress holds "− [ 999 ] / [ 999 ] +": two 44 px buttons,
 * two number boxes and the slash, measured 226 px, plus the cell's 28 px of padding). A table never gets narrower than their sum; any room beyond it is shared
 * in proportion, so Notes grows with the window but never takes it over. Keep in step with lists.css.
 */
export const COL_WIDTHS: Record<ColId, number> = { cover: 64, rating: 80, title: 200, status: 140, progress: 260, genres: 150, creator: 140, avg: 96, notes: 220,
  tags: 180, started: 120, finished: 120, rewatches: 100, airing: 140 };
/** No column is dragged narrower than this. */
export const MIN_COL_WIDTH = 48;
export const NUDGE_PX = 16;

type Widths = Partial<Record<ColId, number>>;
const storeKey = (list: string) => `mt-col-widths:${list}`;

function loadWidths(list: string): Widths {
  try {
    const saved = localStorage.getItem(storeKey(list));
    // Nothing saved on this device: the admin's starting widths (a column they don't name keeps its built-in width).
    const raw: unknown = saved === null ? getDeviceDefaults().columnWidths : JSON.parse(saved);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Widths = {};
    for (const id of Object.keys(COL_WIDTHS) as ColId[]) {
      const v = (raw as Record<string, unknown>)[id];
      if (typeof v === 'number' && Number.isFinite(v)) out[id] = Math.max(MIN_COL_WIDTH, Math.round(v));
    }
    return out;
  } catch {
    return {};
  }
}
function saveWidths(list: string, w: Widths): void {
  try {
    if (Object.keys(w).length === 0) localStorage.removeItem(storeKey(list));
    else localStorage.setItem(storeKey(list), JSON.stringify(w));
  } catch { /* storage unavailable: the widths last for this visit */ }
}

/** The widths a user dragged to, per list (saved in this browser; a friend's table of the same list uses them too). */
export function useColumnWidths(list: string) {
  const [state, setState] = useState(() => ({ list, custom: loadWidths(list) }));
  let custom = state.custom;
  if (state.list !== list) { custom = loadWidths(list); setState({ list, custom }); }
  const commit = useCallback((next: Widths) => { saveWidths(list, next); setState({ list, custom: next }); }, [list]);
  return { custom, commit };
}

/* ---------- Optional columns ("Columns ▾") ---------- */

/** The columns a person can switch on (off by default). Progress and Genres keep their own automatic rules. */
export const OPTIONAL_COLUMNS = [
  { id: 'tags', label: 'Tags' },
  { id: 'started', label: 'Started' },
  { id: 'finished', label: 'Finished' },
  { id: 'rewatches', label: 'Rewatches' },
  { id: 'airing', label: 'Airing' },
] as const satisfies readonly ColumnDef[];
export type OptionalColId = (typeof OPTIONAL_COLUMNS)[number]['id'];
const colsKey = (list: string) => `mt-columns:${list}`;

function loadOptional(list: string): OptionalColId[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(colsKey(list)) ?? 'null');
    if (!Array.isArray(raw)) return [];
    return OPTIONAL_COLUMNS.map((c) => c.id).filter((id) => raw.includes(id));
  } catch {
    return [];
  }
}
function saveOptional(list: string, on: OptionalColId[]): void {
  try {
    if (on.length === 0) localStorage.removeItem(colsKey(list));
    else localStorage.setItem(colsKey(list), JSON.stringify(on));
  } catch { /* storage unavailable: the choice lasts for this visit */ }
}

/** The optional columns switched on for `list`, remembered on this device like the column widths. */
export function useOptionalColumns(list: string) {
  const [state, setState] = useState(() => ({ list, on: loadOptional(list) }));
  let on = state.on;
  if (state.list !== list) { on = loadOptional(list); setState({ list, on }); }
  const toggle = useCallback((id: OptionalColId) => {
    const next = OPTIONAL_COLUMNS.map((c) => c.id).filter((c) => (c === id ? !on.includes(c) : on.includes(c)));
    saveOptional(list, next);
    setState({ list, on: next });
  }, [list, on]);
  return { on, toggle };
}

/** "Columns ▾": a button that opens a small panel of checkboxes. Escape or a click outside closes it and returns focus to the button. */
export function ColumnsMenu({ choices, on, onToggle }: { choices: readonly ColumnDef[]; on: readonly string[]; onToggle: (id: OptionalColId) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div className="columns-menu" ref={root}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
      <button type="button" ref={button} className="btn btn--ghost btn--compact" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}>
        Columns<Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div id={panelId} className="columns-menu__panel" role="group" aria-label="Show columns">
          <h3>Show columns</h3>
          {choices.map((c) => (
            <label key={c.id} className="columns-menu__item">
              <input type="checkbox" checked={on.includes(c.id)} onChange={() => onToggle(c.id as OptionalColId)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Cover viewer ---------- */

/** Off for people who switched "Cover viewer" off in Settings (AppFrame provides it); on where there is no setting (public page). */
export const CoverViewerContext = createContext(true);

export interface ViewerItem {
  id: string;
  title: string;
  category: Category;
  coverUrl: string;
  rating: number | null;
  status: Status | null;
  creator: string;
  releaseDate: string;
  genres: string;
  synopsis: string;
  /** Where the title came from (the viewer's Spotify / trailer / YouTube buttons use it). */
  source?: SourceId | null;
  sourceId?: string | null;
  /** Where "Open" goes; null = no page to open (public profile). */
  to: string | null;
  /** Router state for that page's Back button. */
  state?: unknown;
}

/** How long the pointer rests on a row before the viewer shows it. */
export const HOVER_DELAY_MS = 120;

const isField = (el: EventTarget | null) => el instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
const INTERACTIVE = 'a, button, input, select, textarea, [role="button"], [contenteditable="true"]';

/**
 * Row selection for the cover viewer: click a row (not on a link, button or editor) to select it, ↑/↓ while a row has focus to move,
 * Escape to close. Rows carry the props from `rowProps`; the table carries `tableProps`.
 */
export function useRowViewer(items: ViewerItem[]) {
  const enabled = useContext(CoverViewerContext);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = enabled ? items.find((i) => i.id === selectedId) ?? null : null;
  const tableRef = useRef<HTMLTableElement>(null);
  // Hovering (mouse) or focusing a row shows it after a short pause, so sweeping the pointer down the table doesn't flicker.
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancelHover = () => clearTimeout(hoverTimer.current);
  useEffect(() => cancelHover, []);
  const preview = (id: string) => {
    cancelHover();
    if (id !== selectedId) hoverTimer.current = setTimeout(() => setSelectedId(id), HOVER_DELAY_MS);
  };

  const focusRow = (id: string) => {
    const row = [...(tableRef.current?.querySelectorAll<HTMLElement>('tr[data-row]') ?? [])].find((r) => r.dataset.row === id);
    row?.focus();
    row?.scrollIntoView?.({ block: 'nearest' });
  };
  const close = () => {
    const id = selected?.id;
    setSelectedId(null);
    if (id) requestAnimationFrame(() => focusRow(id));
  };
  const move = (from: string, delta: number) => {
    const i = items.findIndex((x) => x.id === from);
    const next = items[i + delta];
    if (!next) return;
    setSelectedId(next.id);
    focusRow(next.id);
  };

  const rowProps = (id: string): HTMLAttributes<HTMLTableRowElement> & { 'data-row'?: string } => {
    if (!enabled) return {};
    const stop = selected?.id ?? items[0]?.id;
    return {
      'data-row': id,
      'aria-selected': selected?.id === id,
      tabIndex: stop === id ? 0 : -1,
      onClick: (e) => { if (!(e.target as HTMLElement).closest(INTERACTIVE)) { cancelHover(); setSelectedId(id); } },
      onMouseEnter: () => preview(id),
      onMouseLeave: cancelHover,
      onFocus: () => preview(id),
    };
  };
  const tableProps = {
    ref: tableRef,
    onKeyDown: (e: KeyboardEvent<HTMLTableElement>) => {
      if (!enabled) return;
      const target = e.target as HTMLElement;
      if (e.key === 'Escape' && selected && !isField(target)) { e.preventDefault(); close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      if (target.matches('tr[data-row]')) { e.preventDefault(); move(target.dataset.row!, delta); return; }
      // The grid handler has already moved focus to the same column in the next row: the selection follows it.
      if (selected && target.dataset.nav) {
        const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('tr[data-row]')?.dataset.row;
        if (id) setSelectedId(id);
      }
    },
  };
  return { enabled, selected, close, rowProps, tableProps };
}
export type RowViewer = ReturnType<typeof useRowViewer>;

/* ---------- The table frame: columns, resize handles, reset, and the viewer beside it ---------- */

export interface ColumnDef { id: ColId; label: string }

/**
 * A list table: a header with draggable column edges (drag, ←/→ in 16 px steps, double-click to reset one), the saved widths for
 * `list`, a "Reset column widths" button once any are set, and the cover viewer docked beside it. `children` is the <tbody>.
 */
export function TableFrame({ list, label, columns, viewer, children }: {
  list: string; label: string; columns: ColumnDef[]; viewer: RowViewer; children: ReactNode;
}) {
  const uid = useId();
  const { custom, commit } = useColumnWidths(list);
  const table = viewer.tableProps.ref;
  const drag = useRef<{ col: ColId; x: number; width: number; base: Widths } | null>(null);
  const widthOf = (c: ColId) => custom[c] ?? COL_WIDTHS[c];
  const total = columns.reduce((n, c) => n + widthOf(c.id), 0);
  const hasCustom = columns.some((c) => custom[c.id] !== undefined);

  /** Every column's current width: the saved one, else what is drawn now (room beyond the defaults is shared), else its default. */
  const snapshot = (): Widths => {
    const out: Widths = {};
    for (const c of columns) {
      const drawn = table.current?.querySelector<HTMLElement>(`th[data-col="${c.id}"]`)?.getBoundingClientRect().width ?? 0;
      out[c.id] = custom[c.id] ?? (drawn >= MIN_COL_WIDTH ? Math.round(drawn) : COL_WIDTHS[c.id]);
    }
    return out;
  };
  const setCol = (base: Widths, col: ColId, w: number) => ({ ...base, [col]: Math.max(MIN_COL_WIDTH, Math.round(w)) });
  const resetCol = (col: ColId) => {
    if (custom[col] === undefined) return;
    const rest = { ...custom };
    delete rest[col];
    commit(rest);
  };

  const onDown = (col: ColId) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const base = snapshot();
    drag.current = { col, x: e.clientX, width: base[col]!, base };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d) commit(setCol(d.base, d.col, d.width + e.clientX - d.x));
  };
  const onUp = () => { drag.current = null; };
  const onKey = (col: ColId) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const base = snapshot();
    commit(setCol(base, col, base[col]! + (e.key === 'ArrowRight' ? NUDGE_PX : -NUDGE_PX)));
  };

  const style = hasCustom ? { width: total } : { minWidth: total };
  return (
    <div className={`list-split${viewer.selected ? ' list-split--open' : ''}`}>
      <div className="list-split__table">
        {hasCustom && (
          <div className="table-tools">
            <button type="button" className="btn btn--ghost btn--compact" onClick={() => commit({})}>Reset column widths</button>
          </div>
        )}
        <div className="table-wrap">
          <table className="entry-table" aria-label={label} style={style} {...viewer.tableProps}>
            <colgroup>{columns.map((c) => <col key={c.id} style={{ width: widthOf(c.id) }} />)}</colgroup>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th key={c.id} scope="col" data-col={c.id} className={`col-${c.id}`} aria-labelledby={`${uid}-${c.id}`}>
                    <span className="col-label" id={`${uid}-${c.id}`}>{c.label}</span>
                    <button type="button" className={`col-resize${i === columns.length - 1 ? ' col-resize--last' : ''}`}
                      aria-label={`Resize ${c.label} column`} title="Drag to resize. Arrow keys resize by 16 px. Double-click to reset."
                      onPointerDown={onDown(c.id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                      onKeyDown={onKey(c.id)} onDoubleClick={() => resetCol(c.id)} />
                  </th>
                ))}
              </tr>
            </thead>
            {children}
          </table>
        </div>
      </div>
      {viewer.selected && <CoverViewer item={viewer.selected} onClose={viewer.close} />}
    </div>
  );
}
