import { CATEGORY_CONFIG, STATUSES, type Category, type Status } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import type { ListFilter } from '../../lists/filter';
import { LIST_LABEL } from '../../nav';

export interface ListFiltersProps {
  category: Category;
  filter: ListFilter;
  onChange: (next: Partial<ListFilter>) => void;
  genres: { genre: string; count: number }[];
  wide: boolean;
  /** The Sort chip, rendered first in the chip row. */
  sort?: ReactNode;
}

const placeholder = (category: Category): string => {
  const who = CATEGORY_CONFIG[category].creatorLabel;
  return `${who ? `Search titles, ${who.toLowerCase()}s, genres…` : 'Search titles, genres…'}`;
};

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** The search box (PC: always there with a "/" hint; phone: opened by the header's Search button). */
export function SearchBox({ category, filter, onChange, wide, open, onClose }: Pick<ListFiltersProps, 'category' | 'filter' | 'onChange' | 'wide'> & { open: boolean; onClose: () => void }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const list = LIST_LABEL[category];

  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [wide]);

  useEffect(() => { if (!wide && open) ref.current?.focus(); }, [wide, open]);

  if (!wide && !open) return null;
  const clear = () => { onChange({ q: '' }); if (!wide) onClose(); else ref.current?.focus(); };
  return (
    <div className={wide ? 'search search--wide' : 'search'}>
      <label htmlFor={id} className="sr-only">{wide ? `Filter ${list}` : `Search ${list}`}</label>
      <span className="search__icon" aria-hidden="true"><Icon name="search" size={20} /></span>
      <input
        id={id} ref={ref} type="search" aria-keyshortcuts={wide ? '/' : undefined} className="search__input" autoComplete="off" spellCheck={false}
        value={filter.q} placeholder={wide ? placeholder(category).replace('Search', 'Filter') : placeholder(category)}
        onChange={(e) => onChange({ q: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); clear(); } }}
      />
      {filter.q ? (
        <button type="button" className="search__clear" aria-label="Clear search" onClick={clear}><Icon name="close" size={18} /></button>
      ) : wide && <kbd className="search__kbd" aria-hidden="true">/</kbd>}
    </div>
  );
}

/** Phone header button that opens the search field. */
export function SearchToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return <IconButton label="Search" icon="search" aria-expanded={open} className={open ? 'is-on' : undefined} onClick={onClick} />;
}

/** The chip row: Sort, then Status (lists with a Status column) and Genre (lists with genres). */
export function FilterChips({ category, filter, onChange, genres, sort }: Omit<ListFiltersProps, 'wide'>) {
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
          {STATUSES.map((s) => <option key={s} value={s}>Status: {s}</option>)}
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

/** Phone search-open state: open whenever there's a query. */
export function useSearchOpen(q: string): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(q !== '');
  return [open || q !== '', setOpen];
}
