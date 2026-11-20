import { CATEGORY_CONFIG } from '@media-tracker/shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CoverImage } from '../../design/components/CoverImage';
import { Icon } from '../../design/components/Icon';
import { RatingBadge } from '../../design/components/RatingBadge';
import { StatusPill } from '../../design/components/StatusPill';
import { LIST_LABEL } from '../../nav';
import { OpenInSpotify } from '../entry/OpenInSpotify';
import { PlayPreview } from '../entry/PlayPreview';
import { PlayTrailer } from '../entry/PlayTrailer';
import { WatchOnYouTube } from '../entry/WatchOnYouTube';
import type { ViewerItem } from './tableKit';

/** Where the viewer's "You can hide this in Settings." note points: the Cover viewer switch. */
export const COVER_VIEWER_SETTING_PATH = '/settings#cover-viewer';
/** True inside the signed-in app (AppFrame), where there is a Settings screen to link to; false on the public page. */
export const CoverViewerNoteContext = createContext(false);

const SYNOPSIS_MAX = 320;
const shortSynopsis = (s: string): string => {
  const t = s.trim();
  if (t.length <= SYNOPSIS_MAX) return t;
  const cut = t.slice(0, SYNOPSIS_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), SYNOPSIS_MAX - 40)).trimEnd()}…`;
};

/** The title's own buttons wait until it has been on show for a moment, so moving through rows doesn't fetch for each one. */
const ACTIONS_DELAY_MS = 250;

/** Open in Spotify + Play preview for songs and albums, Play trailer for movies, TV and anime, Watch on YouTube for videos. Keyed by title, so each one fetches only while it is shown. */
function ViewerActions({ item }: { item: ViewerItem }) {
  const entry = { ...item, source: item.source ?? null, sourceId: item.sourceId ?? null };
  const music = item.category === 'songs' || item.category === 'albums';
  const video = item.category === 'movies' || item.category === 'tv' || item.category === 'anime';
  if (!music && !video && item.category !== 'youtube') return null;
  return (
    <div className="cover-viewer__actions">
      {music && <OpenInSpotify entry={entry} />}
      {music && <PlayPreview entry={entry} />}
      {video && <PlayTrailer entry={entry} />}
      <WatchOnYouTube entry={entry} />
    </div>
  );
}

/** The panel docked beside the table: the big cover, the facts and the title's buttons. */
export function CoverViewer({ item, onClose }: { item: ViewerItem; onClose: () => void }) {
  const navigate = useNavigate();
  const showNote = useContext(CoverViewerNoteContext);
  const cfg = CATEGORY_CONFIG[item.category];
  const year = item.releaseDate.slice(0, 4);
  const meta = [item.creator, year].filter(Boolean).join(' · ');
  const genres = item.genres.split(',').map((g) => g.trim()).filter(Boolean);
  const synopsis = shortSynopsis(item.synopsis);
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSettled(item.id), ACTIONS_DELAY_MS);
    return () => clearTimeout(t);
  }, [item.id]);
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
      {settled === item.id && <ViewerActions key={item.id} item={item} />}
      {item.to !== null && (
        <button type="button" className="btn btn--primary cover-viewer__open" onClick={() => navigate(item.to!, { state: item.state })}>Open</button>
      )}
      {showNote && <p className="cover-viewer__note">You can hide this in <Link to={COVER_VIEWER_SETTING_PATH}>Settings</Link>.</p>}
    </aside>
  );
}
