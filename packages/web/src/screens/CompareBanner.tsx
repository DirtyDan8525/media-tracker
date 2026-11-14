import type { UserSettings } from '@media-tracker/shared';
import { Link } from 'react-router';
import { useCompareQueue, type QueueItem } from '../data/compare';
import { Icon } from '../design/components/Icon';
import { enabledLists } from '../nav';
import { useSessionMe } from '../shell/SessionGate';

/** Queue items in enabled lists, when Ask is Both or Only for new ratings; otherwise 0 (Ruling P4). */
export function waitingCount(queue: QueueItem[], settings: Pick<UserSettings, 'tabs' | 'compareAsk'>): number {
  if (settings.compareAsk !== 'Both' && settings.compareAsk !== 'Only for new ratings') return 0;
  const enabled = new Set(enabledLists(settings));
  return queue.filter((q) => enabled.has(q.category)).length;
}

/** "N new ratings to double-check" at the top of every list (Ruling P6). Nothing when none are waiting. */
export function CompareBanner() {
  const me = useSessionMe();
  const n = waitingCount(useCompareQueue().data ?? [], me.settings);
  if (n === 0) return null;
  return (
    <div role="status" className="compare-banner">
      <span className="compare-banner__text">{n} new {n === 1 ? 'rating' : 'ratings'} to double-check</span>
      <Link to="/compare" className="btn btn--primary compare-banner__btn"><Icon name="compare" size={16} />Compare</Link>
    </div>
  );
}
