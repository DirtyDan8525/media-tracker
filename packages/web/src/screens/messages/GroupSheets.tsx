import { GROUP_MAX, GROUP_NAME_MAX, type Conversation } from '@media-tracker/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../api/client';
import { useAddMembers, useLeaveConversation, useRenameConversation } from '../../data/messages';
import { useFriends } from '../../data/social';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';
import { CheckRow } from './CheckRow';

export function RenameSheet({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const toast = useToast();
  const rename = useRenameConversation(conversation.id);
  const [name, setName] = useState(conversation.name ?? '');
  async function save() {
    try {
      await rename.mutateAsync(name.trim());
      onClose();
    } catch {
      toast.show("Couldn't rename the group. Try again.");
    }
  }
  return (
    <Sheet open title="Rename group" onClose={onClose}
      footer={<div className="btn-row"><Button variant="primary" disabled={rename.isPending} onClick={() => void save()}>Save</Button><Button onClick={onClose}>Cancel</Button></div>}>
      <form className="field" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="field-label" htmlFor="group-name">Group name</label>
        <input id="group-name" data-autofocus className="input input--lg" value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </form>
    </Sheet>
  );
}

/** Add your friends who are not in the group yet (any member may; the group holds 20). */
export function AddPeopleSheet({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const toast = useToast();
  const friends = useFriends();
  const add = useAddMembers(conversation.id);
  const [picked, setPicked] = useState<string[]>([]);
  const inGroup = new Set(conversation.members.map((m) => m.id));
  const candidates = (friends.data?.friends ?? []).filter((f) => !inGroup.has(f.id));
  const room = GROUP_MAX - conversation.members.length;
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  async function save() {
    try {
      await add.mutateAsync(picked);
      toast.show(picked.length === 1 ? 'Added 1 person' : `Added ${picked.length} people`);
      onClose();
    } catch (e) {
      toast.show(e instanceof ApiError && e.status === 409 ? `A group holds ${GROUP_MAX} people at most.` : "Couldn't add them. Try again.");
    }
  }
  return (
    <Sheet open title="Add people" onClose={onClose}
      footer={<div className="btn-row"><Button variant="primary" disabled={picked.length === 0 || add.isPending} onClick={() => void save()}>{picked.length > 0 ? `Add ${picked.length}` : 'Add'}</Button><Button onClick={onClose}>Cancel</Button></div>}>
      {friends.isPending ? <p className="hint">Loading your friends…</p> : candidates.length === 0 ? (
        <p className="hint">All your friends are already in this group.</p>
      ) : (
        <ul className="plain-list" aria-label="Your friends">
          {candidates.map((f) => (
            <li key={f.id}><CheckRow user={f} checked={picked.includes(f.id)} disabled={!picked.includes(f.id) && picked.length >= room} onChange={(on) => toggle(f.id, on)} /></li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function LeaveSheet({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const leave = useLeaveConversation(conversation.id);
  async function go() {
    try {
      await leave.mutateAsync();
      toast.show('You left the group');
      navigate('/messages', { replace: true });
    } catch {
      toast.show("Couldn't leave the group. Try again.");
    }
  }
  return (
    <Sheet open title="Leave this group?" onClose={onClose}
      footer={<div className="btn-stack"><Button variant="primary" className="btn--big" disabled={leave.isPending} onClick={() => void go()}>Leave group</Button><Button className="btn--big" onClick={onClose}>Cancel</Button></div>}>
      <p className="hint">You'll stop getting its messages. Someone in the group can add you again.</p>
    </Sheet>
  );
}
