import { useState } from 'react';
import { Link } from 'react-router';
import type { PublicUser } from '@media-tracker/shared';
import { ApiError } from '../../api/client';
import { useAccept, useFriends, useSendRequest } from '../../data/social';
import { Button } from '../../design/components/Button';
import { useToast } from '../../design/components/Toast';
import { PersonAvatar } from './parts';
import '../../design/social.css';

type Rel = 'friend' | 'pending_out' | 'pending_in' | null;

/**
 * People rows with Add / Accept / Requested / Friends (Add friend sheet and Search). With `linkProfiles`
 * the avatar and name open their profile (/u/<username>).
 */
export function PeopleList({ users, label, linkProfiles = false }: { users: PublicUser[]; label: string; linkProfiles?: boolean }) {
  const toast = useToast();
  const friends = useFriends();
  const send = useSendRequest();
  const accept = useAccept();
  const [sent, setSent] = useState<Record<string, 'friend' | 'pending_out'>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const relationOf = (id: string): Rel =>
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

  return (
    <ul className="people plain-list" aria-label={label}>
      {users.map((u) => {
        const rel = relationOf(u.id);
        const who = (
          <>
            <PersonAvatar user={u} />
            <span className="person__meta">
              <span className="person__name">@{u.username}</span>
              {u.displayName && <span className="person__sub">{u.displayName}</span>}
            </span>
          </>
        );
        return (
          <li key={u.id} className="person">
            {linkProfiles ? <Link to={`/u/${u.username}`} className="person__link" aria-label={`View @${u.username}`}>{who}</Link> : who}
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
  );
}
