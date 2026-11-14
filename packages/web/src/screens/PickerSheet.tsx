import { CATEGORY_CONFIG, type Category, type LookupInfo } from '@media-tracker/shared';
import { useId, useState, type CSSProperties, type FormEvent } from 'react';
import { Button } from '../design/components/Button';
import { Icon } from '../design/components/Icon';
import { Sheet } from '../design/components/Sheet';
import type { SearchResult } from '../hooks/useAddEntry';
import { isHttpUrl } from '../lookup/query';

export interface PickerSheetProps {
  category: Category;
  typed: string;
  choices: LookupInfo[];
  onChoose: (info: LookupInfo) => void;
  onKeepTyped: () => void;
  onSearch: (term: string) => Promise<SearchResult>;
}

/** "Which one did you mean?": the closest match first, a search box, and a way out that keeps what was typed. */
export function PickerSheet({ category, typed, choices, onChoose, onKeepTyped, onSearch }: PickerSheetProps) {
  const square = CATEGORY_CONFIG[category].square;
  const searchId = useId();
  const [term, setTerm] = useState(typed);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');

  async function search(e: FormEvent) {
    e.preventDefault();
    if (searching) return;
    setSearching(true);
    setMessage('');
    try {
      if ((await onSearch(term)) === 'none') setMessage('Nothing found. Try different words.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <Sheet
      open
      title="Which one did you mean?"
      onClose={onKeepTyped}
      footer={<Button className="btn--block" onClick={onKeepTyped}>None of these — keep what I typed</Button>}
    >
      <div className="picker">
        <p className="picker__typed">You typed "{typed}"</p>
        <form className="picker__search" onSubmit={search} role="search">
          <label className="sr-only" htmlFor={searchId}>Search again</label>
          <input id={searchId} className="input" value={term} onChange={(e) => setTerm(e.target.value)} />
          <Button type="submit" disabled={searching || !term.trim()}>{searching ? 'Searching…' : 'Search'}</Button>
        </form>
        {message && <p role="status" className="field-hint">{message}</p>}
        <ul className="picker__grid plain-list" aria-label="Matches">
          {choices.map((c, i) => {
            const subId = `${searchId}-sub-${i}`;
            return (
              <li key={`${c.source}:${c.sourceId ?? c.title}:${i}`} className="rise-in" style={{ '--i': Math.min(i, 10) } as CSSProperties}>
                <button
                  type="button" className={`picker-card${i === 0 ? ' is-best' : ''}`} aria-label={c.title}
                  aria-describedby={subId} onClick={() => onChoose(c)}
                >
                  <span className={`picker-card__cover${square ? ' picker-card__cover--square' : ''}`}>
                    {c.cover && isHttpUrl(c.cover)
                      ? <img src={c.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      : <Icon name="image" size={24} />}
                    {i === 0 && <span className="picker-card__badge">Closest match</span>}
                  </span>
                  <span className="picker-card__title">{c.title}</span>
                  <span id={subId} className="picker-card__sub">{c.sub || c.creator}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
