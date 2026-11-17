import { Outlet } from 'react-router';
import { BackfillProvider } from '../backfill/useBackfill';
import { useAppSettings } from '../data/appSettings';
import { useUnread } from '../data/feed';
import { useListCounts } from '../data/useEntries';
import { BottomTabs } from '../design/components/BottomTabs';
import { SideNav } from '../design/components/SideNav';
import { useIsWide } from '../hooks';
import { useEnabledLists } from './useLists';
import { useCurrentList } from './currentList';
import { OnboardingHost } from '../screens/onboarding/OnboardingHost';
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
        <OnboardingHost />
      </AddFriendProvider>
    </BackfillProvider>
  );
}

function FrameLayout() {
  const me = useSessionMe();
  const wide = useIsWide();
  const counts = useListCounts().data ?? {};
  const lists = useEnabledLists();
  const { features } = useAppSettings();
  const unread = useUnread().data;
  const activityCount = unread?.feed ?? 0;
  const messagesCount = features.messages ? unread?.messages ?? 0 : 0;
  // Incoming friend requests. The phone's Friends badge adds the unread messages (BottomTabs); PC has a Messages row of its own.
  const requestsCount = features.friends ? unread?.requests ?? 0 : 0;
  const current = useCurrentList();
  if (wide) {
    return (
      <div className="frame frame--wide">
        <SideNav lists={lists} counts={counts} activityCount={activityCount} messagesCount={messagesCount} friendsCount={requestsCount}
          showActivity={features.feed} showMessages={features.messages} showFriends={features.friends} showSharpen={features.closeCalls} me={me} />
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
      <BottomTabs activityCount={activityCount} messagesCount={messagesCount} friendsCount={requestsCount} showActivity={features.feed} showMessages={features.messages} showFriends={features.friends} />
    </div>
  );
}
