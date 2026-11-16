import { Outlet } from 'react-router';
import { BackfillProvider } from '../backfill/useBackfill';
import { useCompareQueue } from '../data/compare';
import { useUnread } from '../data/feed';
import { useListCounts } from '../data/useEntries';
import { BottomTabs } from '../design/components/BottomTabs';
import { SideNav } from '../design/components/SideNav';
import { useIsWide } from '../hooks';
import { waitingCount } from '../screens/CompareBanner';
import { enabledLists } from '../nav';
import { useCurrentList } from './currentList';
import { AddFriendProvider } from './AddFriendHost';
import { AddBubble } from './AddBubble';
import { useSessionMe } from './SessionGate';
import '../design/nav.css';

/**
 * Nav + content. Phone (< 768 px): content above the bottom bar, with the floating Add bubble.
 * PC: side nav beside the content.
 */
export function AppFrame() {
  return (
    <BackfillProvider>
      <AddFriendProvider>
        <FrameLayout />
      </AddFriendProvider>
    </BackfillProvider>
  );
}

function FrameLayout() {
  const me = useSessionMe();
  const wide = useIsWide();
  const counts = useListCounts().data ?? {};
  const lists = enabledLists(me.settings);
  const compareCount = waitingCount(useCompareQueue().data ?? [], me.settings);
  const activityCount = useUnread().data?.feed ?? 0;
  const current = useCurrentList();
  if (wide) {
    return (
      <div className="frame frame--wide">
        <SideNav lists={lists} counts={counts} compareCount={compareCount} activityCount={activityCount} current={current} me={me} />
        <main className="frame__main">
          <Outlet />
        </main>
      </div>
    );
  }
  return (
    <div className="frame frame--phone">
      <main className="frame__main">
        <Outlet />
      </main>
      <AddBubble current={current} />
      <BottomTabs compareCount={compareCount} activityCount={activityCount} />
    </div>
  );
}
