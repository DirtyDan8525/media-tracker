import type { Entry } from '@media-tracker/shared';
import { useMemo, useState } from 'react';
import { useAllEntries } from '../../data/useEntries';
import { recFromEntry } from '../../data/messages';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';
import { Sheet } from '../../design/components/Sheet';
import { MESSAGE_MAX } from '@media-tracker/shared';
import { useEnabledBuiltinLists } from '../../shell/useLists';
import { useSessionMe } from '../../shell/SessionGate';
import type { RecSnapshot } from '@media-tracker/shared';
import { listCfg, listLabel } from '../../lists/registry';

/** The Recommend picker (the composer's Recommend button): one search over ALL your lists, an optional note, and tapping a title sends it. */
export function RecommendPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (rec: RecSnapshot, note: string) => void }) {
  const me = useSessionMe();
  // Built-in lists only: a recommendation is a title a friend can add to the same list (custom lists are each person's own).
  const lists = useEnabledBuiltinLists();
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const { data } = useAllEntries(lists);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return lists.flatMap((c) => data[c] ?? [])
      .filter((e: Entry) => !term || e.title.toLowerCase().includes(term))
      .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title))
      .slice(0, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, lists.join()]);
  return (
    <Sheet open={open} title="Recommend a title" onClose={onClose}>
      <div className="stack-10">
        <input className="input" type="search" aria-label="Search your lists" placeholder="Search your lists" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input" aria-label="Add a note (optional)" placeholder="Add a note (optional)" value={note} maxLength={MESSAGE_MAX} onChange={(e) => setNote(e.target.value)} />
        {rows.length === 0 ? (
          <p className="hint">{q.trim() ? 'No title on your lists matches.' : 'Nothing to recommend here yet.'}</p>
        ) : (
          <ul className="plain-list people" aria-label="Your titles">
            {rows.map((e) => (
              <li key={e.id}>
                <button type="button" className="person person--button" aria-label={`${e.title}, ${listLabel(e.category)}${e.rating !== null ? `, rated ${e.rating}` : ''}`}
                  onClick={() => { onPick(recFromEntry(e), note.trim()); setNote(''); setQ(''); }}>
                  <span aria-hidden="true"><CoverImage src={e.coverUrl} alt="" square={listCfg(e.category).square} width={40} /></span>
                  <span className="person__meta">
                    <span className="person__name">{e.title}</span>
                    <span className="person__sub">{listLabel(e.category)} · you</span>
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
