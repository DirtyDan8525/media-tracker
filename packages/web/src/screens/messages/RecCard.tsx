import { CATEGORY_CONFIG, findDuplicate, type RecSnapshot } from '@media-tracker/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useEntries } from '../../data/useEntries';
import { useAddToMine } from '../../data/social';
import { Button } from '../../design/components/Button';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';
import { useToast } from '../../design/components/Toast';
import { LIST_LABEL } from '../../nav';
import { entryFromRec } from './format';

/**
 * A recommendation (M7): cover, title, list, the sender's rating and note, and Add to mine (as Plan to watch / Plan to
 * read). A title already on your list shows "On your list" as a link to it instead.
 */
export function RecCard({ rec, senderName, note, own = false }: { rec: RecSnapshot; senderName: string; note: string; own?: boolean }) {
  const cfg = CATEGORY_CONFIG[rec.category];
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

  return (
    <article className="rec-card" aria-label={`Recommendation: ${rec.title}`}>
      <div className="rec-card__main">
        <CoverImage src={rec.coverUrl} alt="" square={cfg.square} width={48} />
        <div className="rec-card__meta">
          <b className="rec-card__title">{rec.title}</b>
          <span className="rec-card__sub">{LIST_LABEL[rec.category]}{rec.creator ? ` · ${rec.creator}` : ''}</span>
          {rec.rating !== null && (
            <span className="rec-card__rated">
              <span>{own ? 'You rated' : `${senderName} rated`}</span>
              <RatingBadge rating={rec.rating} size="xs" />
            </span>
          )}
        </div>
      </div>
      {note && <p className="rec-card__note">“{note}”</p>}
      {!own && (onList
        ? <Link className="btn btn--secondary rec-card__action" to={`/entry/${onList}`}>On your list</Link>
        : <Button className="rec-card__action" variant="secondary" disabled={busy} onClick={() => void add()}>Add to mine</Button>)}
    </article>
  );
}
