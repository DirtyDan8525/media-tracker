import { Outlet } from 'react-router';
import { BackfillProvider } from '../backfill/useBackfill';
import { useListCounts } from '../data/useEntries';
import { BottomTabs } from '../design/components/BottomTabs';
import { SideNav } from '../design/components/SideNav';
import { useIsWide } from '../hooks';
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
  if (wide) {
    return (
      <div className="frame frame--wide">
        <SideNav lists={lists} counts={counts} />
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
