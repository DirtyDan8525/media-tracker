import type { UserSettings } from '@media-tracker/shared';
import { Link } from 'react-router';
import { useCompareQueue, type QueueItem } from '../data/compare';
import { useDeviceEntries } from '../data/useEntries';
import { CoverImage } from '../design/components/CoverImage';
import { Icon } from '../design/components/Icon';
import { enabledLists } from '../nav';
import { useSessionMe } from '../shell/SessionGate';

/** Queue items in enabled lists, when Ask is Both or Only for new ratings; otherwise 0 (Ruling P4). */
export function waitingCount(queue: QueueItem[], settings: Pick<UserSettings, 'tabs' | 'compareAsk'>): number {
  if (settings.compareAsk !== 'Both' && settings.compareAsk !== 'Only for new ratings') return 0;
  const enabled = new Set(enabledLists(settings));
  return queue.filter((q) => enabled.has(q.category)).length;
}

/** Up to 3 covers of the queued entries (from the device cache), as the board's overlapping stack. */
function useStackCovers(queue: QueueItem[]) {
  const cats = [...new Set(queue.map((q) => q.category))];
  const entries = useDeviceEntries(cats);
  const byId = new Map(entries.map((e) => [e.id, e]));
  return queue.flatMap((q) => {
    const e = byId.get(q.entryId);
    return e?.coverUrl ? [{ id: e.id, url: e.coverUrl, square: q.category === 'albums' || q.category === 'songs' }] : [];
  }).slice(0, 3);
}

/**
 * "N new ratings to double-check" at the top of every list (Ruling P6). The live region is always
 * mounted (empty when none are waiting) so a change is announced.
 */
export function CompareBanner() {
  const me = useSessionMe();
  const data = useCompareQueue().data ?? [];
  const n = waitingCount(data, me.settings);
  const enabled = new Set(enabledLists(me.settings));
  const covers = useStackCovers(data.filter((q) => enabled.has(q.category)));
  return (
    <div role="status" data-testid="compare-banner-status">
      {n > 0 && (
        <div className="compare-banner">
          {covers.length > 0 && (
            <span className="compare-banner__stack" aria-hidden="true">
              {covers.map((c) => <CoverImage key={c.id} src={c.url} alt="" square={c.square} width={30} />)}
            </span>
          )}
          <span className="compare-banner__text">{n} new {n === 1 ? 'rating' : 'ratings'} to double-check</span>
          <Link to="/compare" className="btn btn--primary compare-banner__btn"><Icon name="compare" size={16} />Compare</Link>
        </div>
      )}
    </div>
  );
}
