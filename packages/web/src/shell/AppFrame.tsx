import { Outlet } from 'react-router';
import { BackfillProvider } from '../backfill/useBackfill';
import { useCompareQueue } from '../data/compare';
import { useListCounts } from '../data/useEntries';
import { BottomTabs } from '../design/components/BottomTabs';
import { SideNav } from '../design/components/SideNav';
import { useIsWide } from '../hooks';
import { waitingCount } from '../screens/CompareBanner';
import { enabledLists, splitForPhone } from '../nav';
import { useSessionMe } from './SessionGate';

/** Nav + content. Phone (< 768 px): content above the bottom tabs. PC: side nav beside the content. */
export function AppFrame() {
  return (
    <BackfillProvider>
      <FrameLayout />
    </BackfillProvider>
  );
}

function FrameLayout() {
  const me = useSessionMe();
  const wide = useIsWide();
  const counts = useListCounts().data ?? {};
  const lists = enabledLists(me.settings);
  const compareCount = waitingCount(useCompareQueue().data ?? [], me.settings);
  if (wide) {
    return (
      <div className="frame frame--wide">
        <SideNav lists={lists} counts={counts} compareCount={compareCount} />
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
      <BottomTabs lists={splitForPhone(lists).tabs} />
    </div>
  );
}
