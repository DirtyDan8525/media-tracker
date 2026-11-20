import { CATEGORY_CONFIG, ORIGIN_LABEL, formatRating, sourceUrl, statusLabel, type FriendEntry } from '@media-tracker/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useAddToMine, useFriendEntry, type AddToMineResult } from '../../data/social';
import { Button } from '../../design/components/Button';
import { CoverBackdrop } from '../../design/components/CoverBackdrop';
import { CoverImage } from '../../design/components/CoverImage';
import { EmptyState } from '../../design/components/EmptyState';
import { RatingBadge } from '../../design/components/RatingBadge';
import { Skeleton } from '../../design/components/Skeleton';
import { StatusPill } from '../../design/components/StatusPill';
import { useToast } from '../../design/components/Toast';
import { BackButton } from '../../shell/BackButton';
import { recFromEntry } from '../../data/messages';
import { ShareButton } from '../messages/ShareButton';
import { EntrySocial } from './EntrySocial';
import '../../design/social.css';
import '../../design/tags.css';
import { OpenInSpotify } from '../entry/OpenInSpotify';
import { PlayPreview } from '../entry/PlayPreview';
import { PlayTrailer } from '../entry/PlayTrailer';

/** A friend's title (route /u/:username/entry/:id, S10): read-only, with their notes unless private, and Add to mine. */
export function FriendEntryDetail() {
  const { username = '', id = '' } = useParams();
  const { data, isPending, error, refetch } = useFriendEntry(username, id);
  if (isPending) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        <div className="screen__body detail"><Skeleton height={180} /><Skeleton height={26} width="60%" /><Skeleton height={80} /></div>
      </div>
    );
  }
  if (!data) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="screen">
        <div className="detail-top"><BackButton to={`/u/${username}`} useHistory pc /></div>
        <div className="screen__body">
          {missing ? (
            <EmptyState icon="info" title="We couldn't find that title" body="It may have been deleted, or it's no longer shared with you."
              actionLabel="Go to Friends" actionHref="/friends" />
          ) : (
            <EmptyState icon="info" title="Couldn't load this title" body="Check your connection and try again." actionLabel="Retry" onAction={() => void refetch()} />
          )}
        </div>
      </div>
    );
  }
  return <Body username={username} entry={data.entry} seasons={data.seasons} />;
}

function Body({ username, entry, seasons }: {
  username: string; entry: FriendEntry; seasons: { id: string; label: string; rating: number | null; notes: string | null }[];
}) {
  const cfg = CATEGORY_CONFIG[entry.category];
  const navigate = useNavigate();
  const toast = useToast();
  const addToMine = useAddToMine();
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<AddToMineResult | null>(null);
  const year = entry.releaseDate.slice(0, 4);
  const meta = [year, entry.lengthLabel].filter(Boolean).join(' · ');
  const genres = entry.genres.split(',').map((g) => g.trim()).filter(Boolean);

  async function add() {
    setBusy(true);
    try {
      const r = await addToMine(entry);
      if (r.duplicate) setDup(r);
      else navigate(`/entry/${r.entryId}`);
    } catch {
      toast.show("Couldn't add it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen has-backdrop">
      <CoverBackdrop src={entry.coverUrl} className="backdrop--top" />
      <div className="detail-top"><BackButton to={`/u/${username}?tab=lists&c=${entry.category}`} useHistory pc /><ShareButton rec={recFromEntry({ ...entry, rating: null })} /></div>
      <div className="screen__body detail">
        <div className="detail__top">
          <CoverImage src={entry.coverUrl} alt={`${entry.title} cover`} square={cfg.square} width={132} className="cover--hero" />
          <div className="detail__facts">
            <h1 className="detail__title">{entry.title}</h1>
            {entry.creator && <span className="detail__fact detail__fact--main">{entry.creator}</span>}
            {meta && <span className="detail__fact">{meta}</span>}
            {entry.origin && <span className="detail__fact">{`${ORIGIN_LABEL[entry.category]}: ${entry.origin}`}</span>}
            {entry.category === 'youtube' && sourceUrl(entry.source, entry.sourceId) && (
              // Dan, 2026-11-17: a video links straight to YouTube.
              <a className="btn btn--primary detail__watch" href={sourceUrl(entry.source, entry.sourceId)!} target="_blank" rel="noopener noreferrer">
                Watch on YouTube
              </a>
            )}
            <OpenInSpotify entry={entry} />
            <PlayPreview entry={entry} />
            <PlayTrailer entry={entry} />
            {genres.length > 0 && (
              <span className="detail__genres">
                <span className="sr-only">{entry.genres}</span>
                {genres.map((g, i) => <span key={`${g}-${i}`} className="genre-pill" aria-hidden="true">{g}</span>)}
              </span>
            )}
          </div>
        </div>

        <div className="friend-panel">
          <div className="person">
            <span className="person__meta">
              <span className="person__sub">Their rating</span>
              {entry.status && cfg.hasStatus && <StatusPill status={entry.status} category={entry.category} />}
            </span>
            <RatingBadge rating={entry.rating} size="lg" />
          </div>

          {(entry.tags?.length ?? 0) > 0 && (
            <section className="detail__section" aria-label="Tags">
              <h2 className="detail__h">Tags</h2>
              <ul className="tag-list">{entry.tags!.map((t) => <li key={t} className="tag-chip tag-chip--read">{t}</li>)}</ul>
            </section>
          )}

          {entry.synopsis && (
            <section className="detail__section" aria-label="Synopsis"><p className="synopsis">{entry.synopsis}</p></section>
          )}

          {seasons.length > 0 && (
            <section className="detail__section" aria-labelledby="fe-seasons">
              <h2 id="fe-seasons" className="detail__h">Seasons</h2>
              <ul className="friend-seasons plain-list">
                {seasons.map((s) => (
                  <li key={s.id} className="friend-season">
                    <span className="friend-season__head">{s.label || 'Season'} <RatingBadge rating={s.rating} size="xs" /></span>
                    {s.notes && <p className="friend-notes">{s.notes}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {entry.notes && (
            <section className="detail__section" aria-labelledby="fe-notes">
              <h2 id="fe-notes" className="detail__h">Notes</h2>
              <p className="friend-notes">{entry.notes}</p>
            </section>
          )}

          <EntrySocial entryId={entry.id} ownerId={entry.userId} title={entry.title} />

          <div className="friend-detail__actions">
            {dup ? (
              <p className="friend-note" role="status">
                Already on your list. <Link to={`/entry/${dup.entryId}`}>Open it</Link>
              </p>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void add()}>{busy ? 'Adding…' : 'Add to mine'}</Button>
            )}
            {!dup && (
              <span className="hint">
                Adds it to your list{cfg.hasStatus ? ` as "${statusLabel('Plan to watch', entry.category)}"` : ''}, without their rating.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
