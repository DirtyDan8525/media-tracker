import { useEffect } from 'react';
import { Link } from 'react-router';
import { useIsWide } from '../../hooks';
import { useFeature } from '../../data/appSettings';
import { useUnread } from '../../data/feed';
import { Icon } from '../../design/components/Icon';
import { countText } from '../../design/components/BottomTabs';
import { FAB_CLASS } from '../../shell/AddBubble';
import '../../design/messages.css';

/**
 * Friends hub, option B (FriendsHub board): the floating speech-bubble button, bottom right above the bar, that opens the chat
 * list. Its badge is the unread messages. Phone only (on PC the Friends page has a Messages button); gone while Messages is switched off.
 * The Add bubble never shows on Friends, so the two never meet; it sits in the same spot and toasts clear it the same way.
 */
export function MessagesBubble() {
  const on = useFeature('messages') && !useIsWide();
  const unread = useUnread().data?.messages ?? 0;
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.classList.add(FAB_CLASS);
    return () => root.classList.remove(FAB_CLASS);
  }, [on]);
  if (!on) return null;
  return (
    <Link to="/messages" className="add-fab messages-fab" aria-label={unread > 0 ? `Messages, ${countText(unread)} unread` : 'Messages'}>
      <Icon name="messages" size={26} />
      {unread > 0 && <span className="count-pill messages-fab__count" aria-hidden="true">{countText(unread)}</span>}
    </Link>
  );
}
