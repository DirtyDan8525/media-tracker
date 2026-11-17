import type { PublicUser } from '@media-tracker/shared';
import { useNavigate } from 'react-router';
import '../../design/messages.css';
import { useCreateConversation } from '../../data/messages';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { useToast } from '../../design/components/Toast';
import { nameOf } from '@media-tracker/shared';

/** A friend's profile header: opens their direct chat, creating it the first time. */
export function MessageButton({ user }: { user: PublicUser }) {
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
  return (
    <Button variant="secondary" className="friend-id__message" aria-label={`Message ${nameOf(user)}`} disabled={create.isPending} onClick={() => void open()}>
      <Icon name="messages" size={18} />Message
    </Button>
  );
}
