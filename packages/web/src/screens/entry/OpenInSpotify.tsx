import { sourceUrl, spotifyUrl, type Category, type SourceId } from '@media-tracker/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

/**
 * "Open in Spotify" on a song or album title page (yours and friends'): straight to the item. A Spotify match
 * links directly; otherwise the Worker looks the item up on Spotify once (/api/spotify/link) and the answer is
 * used as the link. Until that answers, or when it has no match, fails or is not set up, the link is a Spotify
 * search for "title artist", so the button always works. Opens in a new tab. Nothing for other lists.
 */
export function OpenInSpotify({ entry }: { entry: { category: Category; title: string; creator: string; source: SourceId | null; sourceId: string | null } }) {
  const isMusic = entry.category === 'songs' || entry.category === 'albums';
  const fallback = spotifyUrl(entry);
  const direct = entry.source === 'spotify' && sourceUrl('spotify', entry.sourceId) !== null;
  const { data } = useQuery({
    queryKey: ['spotify-link', entry.category, entry.title, entry.creator],
    queryFn: () => {
      const kind = entry.category === 'albums' ? 'album' : 'track';
      return api.get<{ url: string | null }>(`/api/spotify/link?kind=${kind}&title=${encodeURIComponent(entry.title)}&artist=${encodeURIComponent(entry.creator)}`);
    },
    enabled: isMusic && !direct && entry.title.trim() !== '',
    staleTime: Infinity,
    retry: false,
  });
  if (!isMusic) return null;
  const href = !direct && data?.url ? data.url : fallback;
  return (
    <a className="btn btn--primary detail__watch" href={href} target="_blank" rel="noopener noreferrer">
      Open in Spotify
    </a>
  );
}
