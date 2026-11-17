import { CATEGORY_CONFIG, PLAN_STATUS, STATUSES, statusLabel, type Category, type Status } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { Sheet } from '../../design/components/Sheet';
import type { ListFilter } from '../../lists/filter';
import { SORT_KEYS, SORT_LABEL, type SortKey } from '../../lists/sort';
import { LIST_LABEL } from '../../nav';
import '../../design/plan.css';

export interface ListFiltersProps {
  category: Category;
  filter: ListFilter;
  onChange: (next: Partial<ListFilter>) => void;
  genres: { genre: string; count: number }[];
  /** The Sort chip, rendered first in the chip row. */
  sort?: ReactNode;
  /** The Plan to watch view: the list is already only planned titles, so there is no Status chip. */
  planned?: boolean;
}

const placeholder = (category: Category): string => {
  const who = CATEGORY_CONFIG[category].creatorLabel;
  return who ? `Filter titles, ${who.toLowerCase()}s, genres…` : 'Filter titles, genres…';
};

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** The PC list's filter box: always there, "/" focuses it, Escape clears it (B6: the phone has none). */
export function SearchBox({ category, filter, onChange, compact }: Pick<ListFiltersProps, 'category' | 'filter' | 'onChange'> & { compact?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const list = LIST_LABEL[category];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const clear = () => { onChange({ q: '' }); ref.current?.focus(); };
  return (
    <div className={compact ? 'search search--compact' : 'search search--wide'}>
      <label htmlFor={id} className="sr-only">{compact ? 'Search' : 'Filter'} {list}</label>
      <span className="search__icon" aria-hidden="true"><Icon name="search" size={20} /></span>
      <input
        id={id} ref={ref} type="search" aria-keyshortcuts="/" className="search__input" autoComplete="off" spellCheck={false}
        value={filter.q} placeholder={compact ? 'Search' : placeholder(category)}
        onChange={(e) => onChange({ q: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); clear(); } }}
      />
      {filter.q ? (
        <button type="button" className="search__clear" aria-label="Clear search" onClick={clear}><Icon name="close" size={18} /></button>
      ) : !compact && <kbd className="search__kbd" aria-hidden="true">/</kbd>}
    </div>
  );
}

/** The chip row: Sort, then Status (lists with a Status column) and Genre (lists with genres). */
export function FilterChips({ category, filter, onChange, genres, sort, planned }: ListFiltersProps) {
  const showStatus = CATEGORY_CONFIG[category].hasStatus && !planned;
  const showGenre = genres.length > 0 || filter.genre !== '';
  const genreList = filter.genre && !genres.some((g) => g.genre.toLowerCase() === filter.genre.toLowerCase())
    ? [{ genre: filter.genre, count: 0 }, ...genres] : genres;
  if (!sort && !showStatus && !showGenre) return null;
  return (
    <div className="chip-row">
      {sort}
      {showStatus && (
        <select aria-label="Status" className={`select-chip${filter.status ? ' is-on' : ''}`} value={filter.status}
          onChange={(e) => onChange({ status: e.target.value as Status | '' })}>
          <option value="">Status: All</option>
          {STATUSES.map((s) => <option key={s} value={s}>Status: {statusLabel(s, category)}</option>)}
        </select>
      )}
      {showGenre && (
        <select aria-label="Genre" className={`select-chip${filter.genre ? ' is-on' : ''}`} value={filter.genre}
          onChange={(e) => onChange({ genre: e.target.value })}>
          <option value="">Genre: All</option>
          {genreList.map((g) => <option key={g.genre} value={g.genre}>{g.count ? `${g.genre} (${g.count})` : g.genre}</option>)}
        </select>
      )}
    </div>
  );
}

/** The list's own word for Plan to watch ("Plan to play" for games, "Plan to read" for books). */
export const planLabel = (category: Category): string => statusLabel(PLAN_STATUS, category);

/** The Plan to watch switch: on shows only planned titles, in your own order. */
export function PlanSwitch({ category, on, onChange }: { category: Category; on: boolean; onChange: (on: boolean) => void }) {
  const label = planLabel(category);
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="plan-switch" onClick={() => onChange(!on)}>
      <span className="plan-switch__label" aria-hidden="true">{label}</span>
      <span className="plan-switch__track" aria-hidden="true" />
    </button>
  );
}

/** What the Filters button counts and the chips show: the status and the genre. */
export function activeFilters(category: Category, filter: ListFilter, planned: boolean): { key: 'status' | 'genre'; label: string }[] {
  const out: { key: 'status' | 'genre'; label: string }[] = [];
  if (filter.status && !planned) out.push({ key: 'status', label: statusLabel(filter.status, category) });
  if (filter.genre) out.push({ key: 'genre', label: filter.genre });
  return out;
}

/** The phone's filter row: search, the Filters button (with how many are on) and the Plan to watch switch. */
export function FilterBar({ category, filter, onChange, count, onOpenFilters, planSwitch }: {
  category: Category; filter: ListFilter; onChange: (next: Partial<ListFilter>) => void;
  count: number; onOpenFilters: () => void; planSwitch: ReactNode;
}) {
  return (
    <div className="list-bar">
      <SearchBox category={category} filter={filter} onChange={onChange} compact />
      <button type="button" className={`filters-btn${count ? ' is-on' : ''}`} aria-haspopup="dialog"
        aria-label={count ? `Filters, ${count} active` : 'Filters'} onClick={onOpenFilters}>
        Filters{count > 0 && <span className="filters-btn__count" aria-hidden="true">{count}</span>}
      </button>
      {planSwitch}
    </div>
  );
}

/** Active filters as small chips; each removes itself. */
export function ActiveChips({ chips, onRemove }: { chips: { key: 'status' | 'genre'; label: string }[]; onRemove: (key: 'status' | 'genre') => void }) {
  if (!chips.length) return null;
  return (
    <div className="active-chips">
      {chips.map((c) => (
        <button key={c.key} type="button" className="active-chip" aria-label={`Remove filter ${c.label}`} onClick={() => onRemove(c.key)}>
          <span className="active-chip__pill">{c.label}<Icon name="close" size={14} /></span>
        </button>
      ))}
    </div>
  );
}

const GENRES_SHOWN = 8;

/** The Filters bottom sheet: Status, Genres, Sort; Clear and "Show N". Changes apply as you tap. */
export function FilterSheet({ category, filter, onChange, genres, sort, onSort, planned, shown, onClear, onClose }: {
  category: Category; filter: ListFilter; onChange: (next: Partial<ListFilter>) => void;
  genres: { genre: string; count: number }[]; sort: SortKey; onSort: (k: SortKey) => void;
  planned: boolean; shown: number; onClear: () => void; onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const showStatus = CATEGORY_CONFIG[category].hasStatus && !planned;
  const list = filter.genre && !genres.some((g) => g.genre.toLowerCase() === filter.genre.toLowerCase())
    ? [{ genre: filter.genre, count: 0 }, ...genres] : genres;
  const picked = list.findIndex((g) => g.genre.toLowerCase() === filter.genre.toLowerCase());
  const visible = all || list.length <= GENRES_SHOWN ? list : list.filter((g, i) => i < GENRES_SHOWN || i === picked);
  const footer = (
    <div className="filters-sheet__footer">
      <Button variant="ghost" onClick={onClear}>Clear</Button>
      <Button variant="primary" onClick={onClose}>Show {shown}</Button>
    </div>
  );
  return (
    <Sheet open title="Filters" onClose={onClose} footer={footer}>
      <div className="filters-sheet">
        {showStatus && (
          <>
            <h3 className="filters-sheet__label" id="fs-status">Status</h3>
            <div className="filters-sheet__chips" role="group" aria-labelledby="fs-status">
              <Button variant="chip" active={filter.status === ''} onClick={() => onChange({ status: '' })}>All</Button>
              {STATUSES.filter((st) => st !== PLAN_STATUS || filter.status === st).map((st) => (
                <Button key={st} variant="chip" active={filter.status === st} onClick={() => onChange({ status: filter.status === st ? '' : st })}>
                  {statusLabel(st, category)}
                </Button>
              ))}
            </div>
          </>
        )}
        {list.length > 0 && (
          <>
            <h3 className="filters-sheet__label" id="fs-genres">Genres</h3>
            <div className="filters-sheet__chips" role="group" aria-labelledby="fs-genres">
              {visible.map((g) => (
                <Button key={g.genre} variant="chip" active={g.genre.toLowerCase() === filter.genre.toLowerCase()}
                  onClick={() => onChange({ genre: g.genre.toLowerCase() === filter.genre.toLowerCase() ? '' : g.genre })}>
                  {g.genre}
                </Button>
              ))}
              {list.length > GENRES_SHOWN && (
                <Button variant="chip" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? 'Fewer' : 'More'}</Button>
              )}
            </div>
          </>
        )}
        {!planned && (
          <>
            <h3 className="filters-sheet__label" id="fs-sort">Sort</h3>
            <div className="seg-radio" role="radiogroup" aria-labelledby="fs-sort">
              {SORT_KEYS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => onSort(k)}>{SORT_LABEL[k]}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
