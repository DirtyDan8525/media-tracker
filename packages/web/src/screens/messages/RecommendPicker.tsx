import type { Category, Entry } from '@media-tracker/shared';
import { CATEGORY_CONFIG } from '@media-tracker/shared';
import { useMemo, useState } from 'react';
import { useAllEntries } from '../../data/useEntries';
import { recFromEntry } from '../../data/messages';
import { Button } from '../../design/components/Button';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';
import { Sheet } from '../../design/components/Sheet';
import { LIST_LABEL } from '../../nav';
import { useEnabledLists } from '../../shell/useLists';
import { useSessionMe } from '../../shell/SessionGate';
import type { RecSnapshot } from '@media-tracker/shared';

/** The Recommend picker (from + in a chat): a title from your own lists, filtered by list; tapping one sends it. */
export function RecommendPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (rec: RecSnapshot) => void }) {
  const me = useSessionMe();
  const lists = useEnabledLists();
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [q, setQ] = useState('');
  const { data } = useAllEntries(lists);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return lists.flatMap((c) => (filter === 'all' || filter === c ? data[c] ?? [] : []))
      .filter((e: Entry) => !term || e.title.toLowerCase().includes(term))
      .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title))
      .slice(0, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, q, lists.join()]);
  return (
    <Sheet open={open} title="Recommend a title" onClose={onClose}>
      <div className="stack-10">
        <input className="input" type="search" aria-label="Search your lists" placeholder="Search your lists" value={q} onChange={(e) => setQ(e.target.value)} />
        <div role="group" aria-label="List" className="chip-row">
          <Button variant="chip" active={filter === 'all'} onClick={() => setFilter('all')}>All</Button>
          {lists.map((c) => <Button key={c} variant="chip" active={filter === c} onClick={() => setFilter(c)}>{LIST_LABEL[c]}</Button>)}
        </div>
        {rows.length === 0 ? (
          <p className="hint">Nothing to recommend here yet.</p>
        ) : (
          <ul className="plain-list people" aria-label="Your titles">
            {rows.map((e) => (
              <li key={e.id}>
                <button type="button" className="person person--button" aria-label={`${e.title}, ${LIST_LABEL[e.category]}${e.rating !== null ? `, rated ${e.rating}` : ''}`}
                  onClick={() => onPick(recFromEntry(e))}>
                  <span aria-hidden="true"><CoverImage src={e.coverUrl} alt="" square={CATEGORY_CONFIG[e.category].square} width={40} /></span>
                  <span className="person__meta">
                    <span className="person__name">{e.title}</span>
                    <span className="person__sub">{LIST_LABEL[e.category]} · you</span>
                  </span>
                  <RatingBadge rating={e.rating} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
