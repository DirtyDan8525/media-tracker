import { spotifyUrl, type Category, type SourceId } from '@media-tracker/shared';

/**
 * "Open in Spotify" on a song or album title page (yours and friends'): straight to the item when it was matched
 * from Spotify, otherwise a Spotify search for "title artist". Opens in a new tab. Nothing for other lists.
 */
export function OpenInSpotify({ entry }: { entry: { category: Category; title: string; creator: string; source: SourceId | null; sourceId: string | null } }) {
  if (entry.category !== 'songs' && entry.category !== 'albums') return null;
  return (
    <a className="btn btn--primary detail__watch" href={spotifyUrl(entry)} target="_blank" rel="noopener noreferrer">
      Open in Spotify
    </a>
  );
}
