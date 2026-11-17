import { MESSAGE_MAX, type RecSnapshot } from '@media-tracker/shared';
import { useState } from 'react';
import { conversationTitle, useConversations, useShareRec } from '../../data/messages';
import { useFriends } from '../../data/social';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';
import { LIST_LABEL } from '../../nav';
import { useSessionMe } from '../../shell/SessionGate';
import { CheckRow } from './CheckRow';

/** Share (M7): send this title to friends and/or groups, with an optional note. The caller shows it from a Share button. */
export function ShareSheet({ open, rec, onClose }: { open: boolean; rec: RecSnapshot; onClose: () => void }) {
  return open ? <ShareBody rec={rec} onClose={onClose} /> : null;
}

function ShareBody({ rec, onClose }: { rec: RecSnapshot; onClose: () => void }) {
  const me = useSessionMe();
  const toast = useToast();
  const friends = useFriends();
  const chats = useConversations();
  const share = useShareRec();
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const groups = (chats.data ?? []).filter((c) => c.kind === 'group');
  const count = friendIds.length + groupIds.length;
  const flip = (set: (f: (p: string[]) => string[]) => void) => (id: string, on: boolean) => set((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

  async function send() {
    try {
      const r = await share.mutateAsync({ friendIds, groupIds, rec, text: note.trim() });
      if (r.sent > 0 && r.failed === 0) toast.show(`Sent to ${r.sent}`);
      else if (r.sent > 0) toast.show(`Sent to ${r.sent}. Couldn't send to ${r.failed}.`);
      else toast.show(r.rateLimited ? "You're sending too fast. Wait a minute and try again." : "Couldn't send. Try again.");
      if (r.sent > 0) { setFriendIds([]); setGroupIds([]); setNote(''); onClose(); }
    } catch {
      toast.show("Couldn't send. Try again.");
    }
  }

  return (
    <Sheet open title={`Recommend ${rec.title}`} onClose={onClose}
      footer={<Button variant="primary" className="btn--big" disabled={count === 0 || share.isPending} onClick={() => void send()}>{count > 0 ? `Send to ${count}` : 'Send'}</Button>}>
      <div className="stack-10">
        <p className="hint">{LIST_LABEL[rec.category]}{rec.rating !== null ? ` · your rating ${rec.rating.toFixed(1)} shows on the card` : ''}</p>
        <section aria-labelledby="share-friends">
          <h3 id="share-friends" className="group__title">Friends</h3>
          {friends.isPending ? <p className="hint">Loading…</p> : (friends.data?.friends.length ?? 0) === 0 ? <p className="hint">No friends yet.</p> : (
            <ul className="plain-list" aria-label="Friends">
              {friends.data!.friends.map((f) => <li key={f.id}><CheckRow user={f} checked={friendIds.includes(f.id)} onChange={(on) => flip(setFriendIds)(f.id, on)} /></li>)}
            </ul>
          )}
        </section>
        {groups.length > 0 && (
          <section aria-labelledby="share-groups">
            <h3 id="share-groups" className="group__title">Groups</h3>
            <ul className="plain-list" aria-label="Groups">
              {groups.map((g) => (
                <li key={g.id}><CheckRow group title={conversationTitle(g, me.id)} sub={`${g.members.length} members`} checked={groupIds.includes(g.id)} onChange={(on) => flip(setGroupIds)(g.id, on)} /></li>
              ))}
            </ul>
          </section>
        )}
        <input className="input" aria-label="Add a note (optional)" placeholder="Add a note (optional)" value={note} maxLength={MESSAGE_MAX} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Sheet>
  );
}
