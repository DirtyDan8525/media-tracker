import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Category, SourceId } from '@media-tracker/shared';
import { api } from '../../api/client';
import { Sheet } from '../../design/components/Sheet';
import { Button } from '../../design/components/Button';
import '../../design/media.css';

type TrailerEntry = { category: Category; title: string; releaseDate: string; source: SourceId | null; sourceId: string | null };

const KIND: Partial<Record<Category, 'movie' | 'tv' | 'anime'>> = { movies: 'movie', tv: 'tv', anime: 'anime' };

/**
 * "▶ Play trailer" on movie, TV and anime title pages (Phase 7, board 7), in the spot where songs get Open in Spotify.
 * The Worker finds a YouTube id (/api/trailer: TMDB for movies and shows, Kitsu for anime); nothing shows until it does.
 * The button opens a sheet with a privacy-enhanced (youtube-nocookie) embed; closing removes the iframe so the sound stops.
 */
export function PlayTrailer({ entry }: { entry: TrailerEntry }) {
  const kind = KIND[entry.category];
  const year = /^\d{4}/.test(entry.releaseDate) ? entry.releaseDate.slice(0, 4) : '';
  // A stored id helps only where it names the same thing: TMDB movies, Kitsu anime.
  const id = (kind === 'movie' && entry.source === 'tmdb') || (kind === 'anime' && entry.source === 'kitsu') ? (entry.sourceId ?? '') : '';
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['trailer', kind, entry.title, year, id],
    queryFn: () => api.get<{ youtubeId: string | null }>(
      `/api/trailer?kind=${kind}&title=${encodeURIComponent(entry.title)}&year=${year}${/^\d{1,9}$/.test(id) ? `&id=${id}` : ''}`),
    enabled: kind !== undefined && entry.title.trim() !== '',
    staleTime: Infinity,
    retry: false,
  });
  const youtubeId = data?.youtubeId ?? null;
  if (!kind || !youtubeId || !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return null;
  return (
    <>
      <button type="button" className="btn btn--secondary detail__watch" onClick={() => setOpen(true)}>▶ Play trailer</button>
      <Sheet open={open} title={`${entry.title} trailer`} onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>Close</Button>}>
        <div className="trailer__frame">
          <iframe
            title={`${entry.title} trailer`}
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1`}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </Sheet>
    </>
  );
}
