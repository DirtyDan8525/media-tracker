import { sourceUrl, type Category, type SourceId } from '@media-tracker/shared';

/** "Watch on YouTube" on a video's title page and in the cover viewer (Dan, 2026-11-17): straight to the video. Nothing for other lists. */
export function WatchOnYouTube({ entry }: { entry: { category: Category; source: SourceId | null; sourceId: string | null } }) {
  const href = entry.category === 'youtube' ? sourceUrl(entry.source, entry.sourceId) : null;
  if (!href) return null;
  return (
    <a className="btn btn--primary detail__watch" href={href} target="_blank" rel="noopener noreferrer">
      Watch on YouTube
    </a>
  );
}
