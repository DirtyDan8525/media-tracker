import type { Conversation } from '@media-tracker/shared';
import { Avatar } from '../../design/components/Avatar';
import { Icon } from '../../design/components/Icon';

/** A chat's picture: the other person's for a direct chat, a group icon for a group. */
export function ChatAvatar({ conversation, meId, size = 48 }: { conversation: Pick<Conversation, 'kind' | 'members'>; meId: string; size?: number }) {
  const other = conversation.members.find((m) => m.id !== meId);
  if (conversation.kind === 'direct' && other) return <Avatar user={other} size={size} />;
  return <span className="chat-avatar chat-avatar--group" style={{ width: size, height: size }} aria-hidden="true"><Icon name="group" size={Math.round(size * 0.45)} /></span>;
}
