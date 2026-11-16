import { CATEGORY_CONFIG, STATUSES, statusLabel, type Category, type Status } from '@media-tracker/shared';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../../design/components/Icon';
import type { ListFilter } from '../../lists/filter';
import { LIST_LABEL } from '../../nav';

export interface ListFiltersProps {
  category: Category;
  filter: ListFilter;
  onChange: (next: Partial<ListFilter>) => void;
  genres: { genre: string; count: number }[];
  /** The Sort chip, rendered first in the chip row. */
  sort?: ReactNode;
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
export function SearchBox({ category, filter, onChange }: Pick<ListFiltersProps, 'category' | 'filter' | 'onChange'>) {
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
    <div className="search search--wide">
      <label htmlFor={id} className="sr-only">Filter {list}</label>
      <span className="search__icon" aria-hidden="true"><Icon name="search" size={20} /></span>
      <input
        id={id} ref={ref} type="search" aria-keyshortcuts="/" className="search__input" autoComplete="off" spellCheck={false}
        value={filter.q} placeholder={placeholder(category)}
        onChange={(e) => onChange({ q: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); clear(); } }}
      />
      {filter.q ? (
        <button type="button" className="search__clear" aria-label="Clear search" onClick={clear}><Icon name="close" size={18} /></button>
      ) : <kbd className="search__kbd" aria-hidden="true">/</kbd>}
    </div>
  );
}

/** The chip row: Sort, then Status (lists with a Status column) and Genre (lists with genres). */
export function FilterChips({ category, filter, onChange, genres, sort }: ListFiltersProps) {
  const showStatus = CATEGORY_CONFIG[category].hasStatus;
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
