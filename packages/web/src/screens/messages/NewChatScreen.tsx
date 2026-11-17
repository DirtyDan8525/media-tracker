import { GROUP_MAX, GROUP_NAME_MAX } from '@media-tracker/shared';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useCreateConversation } from '../../data/messages';
import { useFriends } from '../../data/social';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { PageHeader } from '../../shell/PageHeader';
import { CheckRow } from './CheckRow';
import '../../design/messages.css';

/** New chat (route /messages/new): pick friends. One opens a direct chat; two or more make a group (optional name). */
export function NewChatScreen() {
  const navigate = useNavigate();
  const wantsGroup = useSearchParams()[0].get('group') === '1';
  const toast = useToast();
  const friends = useFriends();
  const create = useCreateConversation();
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  const group = picked.length > 1;

  async function start() {
    try {
      const c = await create.mutateAsync({ userIds: picked, ...(group && name.trim() ? { name: name.trim() } : {}) });
      navigate(`/messages/${c.id}`, { replace: true });
    } catch {
      toast.show("Couldn't start the chat. Try again.");
    }
  }

  const header = <PageHeader title={wantsGroup ? 'New group' : 'New chat'} backTo="/messages" backUsesHistory />;
  if (friends.isPending) {
    return <div className="screen" aria-busy="true" aria-label="Loading">{header}<div className="screen__body stack-10"><Skeleton height={56} /><Skeleton height={56} /></div></div>;
  }
  if (friends.isError || !friends.data) {
    return <div className="screen">{header}<div className="screen__body"><EmptyState icon="info" title="Couldn't load your friends" body="Check your connection and try again." actionLabel="Retry" onAction={() => void friends.refetch()} /></div></div>;
  }
  if (friends.data.friends.length === 0) {
    return <div className="screen">{header}<div className="screen__body"><EmptyState icon="user" title="No friends yet" body="Add a friend to start a chat." actionLabel="Go to Friends" actionHref="/friends" /></div></div>;
  }
  return (
    <div className="screen">
      {header}
      <div className="screen__body stack-10 new-chat">
        <ul className="plain-list" aria-label="Your friends">
          {friends.data.friends.map((f) => (
            <li key={f.id}><CheckRow user={f} checked={picked.includes(f.id)} disabled={!picked.includes(f.id) && picked.length >= GROUP_MAX - 1} onChange={(on) => toggle(f.id, on)} /></li>
          ))}
        </ul>
        {group && (
          <div className="field">
            <label className="field-label" htmlFor="new-group-name">Group name <span className="field-label__opt">(optional)</span></label>
            <input id="new-group-name" className="input" value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <p className="hint" role="status">
          {picked.length === 0 ? (wantsGroup ? 'Pick two or more friends for a group.' : 'Pick a friend, or several for a group.') : picked.length === 1 ? '1 picked · direct chat' : `${picked.length} picked · group`}
        </p>
        <Button variant="primary" className="btn--big" disabled={picked.length === 0 || (wantsGroup && picked.length < 2) || create.isPending} onClick={() => void start()}>{wantsGroup ? 'Start group' : 'Start chat'}</Button>
      </div>
    </div>
  );
}
