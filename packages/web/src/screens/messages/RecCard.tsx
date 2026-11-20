import { findDuplicate, type RecSnapshot } from '@media-tracker/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useEntries } from '../../data/useEntries';
import { useAddToMine } from '../../data/social';
import { Button } from '../../design/components/Button';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';
import { useToast } from '../../design/components/Toast';
import { entryFromRec } from './format';
import { listCfg, listLabel } from '../../lists/registry';

/**
 * A recommendation (M7): cover, title, list, the sender's rating and note, and Add to mine (as Plan to watch / Plan to
 * read). A title already on your list shows "On your list" as a link to it instead.
 */
export function RecCard({ rec, senderName, senderUsername, note, own = false }: { rec: RecSnapshot; senderName: string; senderUsername?: string; note: string; own?: boolean }) {
  const cfg = listCfg(rec.category);
  const toast = useToast();
  const addToMine = useAddToMine();
  const mine = useEntries(rec.category).data;
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onList = added ?? (mine ? findDuplicate(mine, { title: rec.title, creator: rec.creator ?? '' }, rec.category) : null);

  async function add() {
    setBusy(true);
    try {
      const r = await addToMine(entryFromRec(rec));
      setAdded(r.entryId);
      if (!r.duplicate) toast.show(`Added ${rec.title} to your list`);
    } catch {
      toast.show("Couldn't add it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Tapping the card opens the title: yours for a card you sent (its own entry, else the one with that title), the sender's for a received one
  // (their entry page, when the card knows it), else your own copy if you have it.
  const mineId = own ? (rec.entryId && (!mine || mine.some((e) => e.id === rec.entryId)) ? rec.entryId : onList) : null;
  const href = own ? (mineId ? `/entry/${mineId}` : null)
    : rec.entryId && senderUsername ? `/u/${encodeURIComponent(senderUsername)}/entry/${encodeURIComponent(rec.entryId)}`
    : onList ? `/entry/${onList}` : null;
  const main = (
    <>
        <CoverImage src={rec.coverUrl} alt="" square={cfg.square} width={48} />
        <div className="rec-card__meta">
          <b className="rec-card__title">{rec.title}</b>
          <span className="rec-card__sub">{listLabel(rec.category)}{rec.creator ? ` · ${rec.creator}` : ''}</span>
          {rec.rating !== null && (
            <span className="rec-card__rated">
              <span>{own ? 'You rated' : `${senderName} rated`}</span>
              <RatingBadge rating={rec.rating} size="xs" />
            </span>
          )}
        </div>
    </>
  );

  return (
    <article className="rec-card" aria-label={`Recommendation: ${rec.title}`}>
      {href
        ? <Link className="rec-card__main rec-card__open" to={href}>{main}</Link>
        : <div className="rec-card__main">{main}</div>}
      {note && <p className="rec-card__note">“{note}”</p>}
      {!own && (onList
        ? <Link className="btn btn--secondary rec-card__action" to={`/entry/${onList}`}>On your list</Link>
        : <Button className="rec-card__action" variant="secondary" disabled={busy} onClick={() => void add()}>Add to mine</Button>)}
    </article>
  );
}
