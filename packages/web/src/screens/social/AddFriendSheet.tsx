import { ApiError } from '../../api/client';
import { useState } from 'react';
import {
  inviteLink, searchable, useAccept, useCopy, useFriends, useInviteCode, useRegenerateCode, useSendRequest, useUserSearch,
} from '../../data/social';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { PersonAvatar, useDebounced } from './parts';
import '../../design/social.css';

/** Add friend (AddFriend.wf): find someone by username, or hand them your invite link. */
export function AddFriendSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open title="Add friend" onClose={onClose}>
      <AddFriendBody />
    </Sheet>
  );
}

function AddFriendBody() {
  const toast = useToast();
  const [text, setText] = useState('');
  const query = useDebounced(text);
  const search = useUserSearch(query);
  const friends = useFriends();
  const send = useSendRequest();
  const accept = useAccept();
  const [sent, setSent] = useState<Record<string, 'friend' | 'pending_out'>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const relationOf = (id: string): 'friend' | 'pending_out' | 'pending_in' | null =>
    sent[id] ?? (friends.data?.friends.some((f) => f.id === id) ? 'friend'
      : friends.data?.outgoing.some((f) => f.id === id) ? 'pending_out'
      : friends.data?.incoming.some((f) => f.id === id) ? 'pending_in' : null);

  async function add(id: string, username: string) {
    setBusy(id);
    try {
      const { relation } = await send.mutateAsync(username);
      setSent((s) => ({ ...s, [id]: relation === 'friend' ? 'friend' : 'pending_out' }));
      if (relation === 'friend') toast.show(`You and @${username} are friends`);
    } catch (err) {
      if (err instanceof ApiError && err.error === 'already_friends') setSent((s) => ({ ...s, [id]: 'friend' }));
      else toast.show("Couldn't send the request. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function acceptThem(id: string, username: string) {
    setBusy(id);
    try {
      await accept.mutateAsync(id);
      setSent((s) => ({ ...s, [id]: 'friend' }));
      toast.show(`You and @${username} are friends`);
    } catch {
      toast.show("Couldn't accept. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const waiting = (text.trim() === '' || searchable(text)) && (text !== query || search.isFetching) && !search.data;
  return (
    <div className="add-friend">
      <div className="stack-10">
        <label htmlFor="add-friend-q" className="field-label">Username</label>
        <div className="text-field">
          <span className="text-field__prefix" aria-hidden="true">@</span>
          <input id="add-friend-q" type="text" value={text} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            maxLength={21} enterKeyHint="search" aria-label="Username" onChange={(e) => setText(e.target.value)} />
        </div>
        <div aria-live="polite">
          {text.trim() !== '' && !searchable(text) ? (
            <p className="hint">Type at least 2 letters or numbers of their username.</p>
          ) : waiting ? (
            <Skeleton height={64} />
          ) : search.isError ? (
            <p className="hint">Couldn't search. Check your connection and try again.</p>
          ) : search.data && search.data.length === 0 ? (
            <p className="hint">{text.trim() === '' ? 'No one else has an account yet. Send them your invite link below.' : 'No one has that username. Check the spelling, or send them your invite link below.'}</p>
          ) : (
            <ul className="people plain-list" aria-label={text.trim() === '' ? 'Everyone' : 'Search results'}>
              {search.data?.map((u) => {
                const rel = relationOf(u.id);
                return (
                  <li key={u.id} className="person">
                    <PersonAvatar user={u} />
                    <span className="person__meta">
                      <span className="person__name">@{u.username}</span>
                      {u.displayName && <span className="person__sub">{u.displayName}</span>}
                    </span>
                    {rel === 'friend' ? <span className="person__sub">Friends</span>
                      : rel === 'pending_out' ? <span className="person__sub">Requested</span>
                      : rel === 'pending_in' ? (
                        <Button variant="primary" compact aria-label={`Accept @${u.username}`} disabled={busy === u.id}
                          onClick={() => void acceptThem(u.id, u.username)}>Accept</Button>
                      ) : (
                        <Button variant="primary" compact aria-label={`Add @${u.username}`} disabled={busy === u.id}
                          onClick={() => void add(u.id, u.username)}>Add</Button>
                      )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <InviteLink />
    </div>
  );
}

function InviteLink() {
  const code = useInviteCode();
  const regen = useRegenerateCode();
  const copy = useCopy();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const link = code.data ? inviteLink(code.data) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function share() {
    try {
      await navigator.share({ title: 'Media Tracker', text: 'Add me on Media Tracker', url: link });
    } catch {
      // closed without sharing: nothing to say
    }
  }

  return (
    <section aria-labelledby="add-friend-link" className="add-friend__link">
      <h3 id="add-friend-link" className="group__title">Your invite link</h3>
      {code.isError ? (
        <p className="hint">Couldn't load your link. <Button variant="ghost" compact onClick={() => void code.refetch()}>Try again</Button></p>
      ) : !code.data ? (
        <Skeleton height={50} />
      ) : confirm ? (
        <div className="confirm" role="group" aria-label="Make a new link">
          <p className="confirm__title">Make a new link?</p>
          <p className="hint">The old link will stop working. Anyone you sent it to will need the new one.</p>
          <div className="btn-row">
            <Button variant="primary" disabled={regen.isPending}
              onClick={() => regen.mutate(undefined, {
                onSuccess: () => { setConfirm(false); toast.show('New link ready'); },
                onError: () => toast.show("Couldn't make a new link. Try again."),
              })}>Make new link</Button>
            <Button onClick={() => setConfirm(false)}>Keep old link</Button>
          </div>
        </div>
      ) : (
        <>
          <input className="link-box" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <div className="btn-row">
            <Button onClick={() => void copy(link)}>Copy</Button>
            {canShare && <Button onClick={() => void share()}>Share</Button>}
          </div>
          <Button variant="ghost" onClick={() => setConfirm(true)}>Make a new link</Button>
        </>
      )}
    </section>
  );
}
