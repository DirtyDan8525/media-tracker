import { CATEGORY_CONFIG, type Category, type Status } from '@media-tracker/shared';
import { createContext, useCallback, useId, useContext, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { CoverImage } from '../../design/components/CoverImage';
import { Icon } from '../../design/components/Icon';
import { RatingBadge } from '../../design/components/RatingBadge';
import { StatusPill } from '../../design/components/StatusPill';
import { LIST_LABEL } from '../../nav';

/* ---------- Column widths ---------- */

export type ColId = 'cover' | 'rating' | 'title' | 'status' | 'progress' | 'genres' | 'creator' | 'avg' | 'notes';

/**
 * Default column widths in px: each is as narrow as its content allows (Progress holds "− [ 999 ] / [ 999 ] +": two 44 px buttons,
 * two number boxes and the slash, measured 226 px, plus the cell's 28 px of padding). A table never gets narrower than their sum; any room beyond it is shared
 * in proportion, so Notes grows with the window but never takes it over. Keep in step with lists.css.
 */
export const COL_WIDTHS: Record<ColId, number> = { cover: 64, rating: 80, title: 200, status: 140, progress: 260, genres: 150, creator: 140, avg: 96, notes: 220 };
/** No column is dragged narrower than this. */
export const MIN_COL_WIDTH = 48;
export const NUDGE_PX = 16;

type Widths = Partial<Record<ColId, number>>;
const storeKey = (list: string) => `mt-col-widths:${list}`;

function loadWidths(list: string): Widths {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storeKey(list)) ?? 'null');
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
  /** Where "Open" goes; null = no page to open (public profile). */
  to: string | null;
  /** Router state for that page's Back button. */
  state?: unknown;
}

const SYNOPSIS_MAX = 320;
const shortSynopsis = (s: string): string => {
  const t = s.trim();
  if (t.length <= SYNOPSIS_MAX) return t;
  const cut = t.slice(0, SYNOPSIS_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), SYNOPSIS_MAX - 40)).trimEnd()}…`;
};

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
      onClick: (e) => { if (!(e.target as HTMLElement).closest(INTERACTIVE)) setSelectedId(id); },
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

/** The panel docked beside the table: the big cover and the facts. */
export function CoverViewer({ item, onClose }: { item: ViewerItem; onClose: () => void }) {
  const navigate = useNavigate();
  const cfg = CATEGORY_CONFIG[item.category];
  const year = item.releaseDate.slice(0, 4);
  const meta = [item.creator, year].filter(Boolean).join(' · ');
  const genres = item.genres.split(',').map((g) => g.trim()).filter(Boolean);
  const synopsis = shortSynopsis(item.synopsis);
  return (
    <aside className="cover-viewer" aria-label={`${item.title}, cover viewer`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <button type="button" className="cover-viewer__close" aria-label="Close cover viewer" title="Close" onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
      <CoverImage src={item.coverUrl} alt={`${item.title} cover`} square={cfg.square} fluid width={320} className="cover--hero cover-viewer__cover" />
      <h2 className="cover-viewer__title">{item.title}</h2>
      <p className="cover-viewer__list">{LIST_LABEL[item.category]}</p>
      <div className="cover-viewer__facts">
        <RatingBadge rating={item.rating} size="md" />
        {item.status && cfg.hasStatus && <StatusPill status={item.status} category={item.category} />}
      </div>
      {meta && <p className="cover-viewer__meta">{meta}</p>}
      {genres.length > 0 && (
        <p className="cover-viewer__genres">
          <span className="sr-only">{item.genres}</span>
          {genres.map((g, i) => <span key={`${g}-${i}`} className="genre-pill" aria-hidden="true">{g}</span>)}
        </p>
      )}
      {synopsis && <p className="cover-viewer__synopsis">{synopsis}</p>}
      {item.to !== null && (
        <button type="button" className="btn btn--primary cover-viewer__open" onClick={() => navigate(item.to!, { state: item.state })}>Open</button>
      )}
    </aside>
  );
}

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
