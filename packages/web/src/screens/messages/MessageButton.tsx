import type { PublicUser } from '@media-tracker/shared';
import { useNavigate } from 'react-router';
import '../../design/messages.css';
import { useCreateConversation } from '../../data/messages';
import { useFeature } from '../../data/appSettings';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { useToast } from '../../design/components/Toast';
import { nameOf } from '@media-tracker/shared';

/** Opens the direct chat with `user`, creating it the first time. */
function useOpenChat(user: PublicUser) {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateConversation();
  async function open() {
    try {
      const c = await create.mutateAsync({ userIds: [user.id] });
      navigate(`/messages/${c.id}`);
    } catch {
      toast.show("Couldn't open the chat. Try again.");
    }
  }
  return { open, pending: create.isPending };
}

/** A friend's profile header: opens their direct chat, creating it the first time. */
export function MessageButton({ user }: { user: PublicUser }) {
  const chat = useOpenChat(user);
  if (!useFeature('messages')) return null;
  return (
    <Button variant="secondary" className="friend-id__message" aria-label={`Message ${nameOf(user)}`} disabled={chat.pending} onClick={() => void chat.open()}>
      <Icon name="messages" size={18} />Message
    </Button>
  );
}

/** A friend row's round "Message <name>" button (phone) or a labelled button (a friend card on PC); none while Messages is off. */
export function MessageFriendButton({ user, labelled }: { user: PublicUser; labelled?: boolean }) {
  const chat = useOpenChat(user);
  if (!useFeature('messages')) return null;
  const label = `Message ${nameOf(user)}`;
  if (labelled) {
    return <Button compact className="friend-card__btn" aria-label={label} disabled={chat.pending} onClick={() => void chat.open()}>Message</Button>;
  }
  return <IconButton label={label} icon="messages" className="friend-row__message" disabled={chat.pending} onClick={() => void chat.open()} />;
}
