import { useState } from 'react';
import { Link } from 'react-router';
import { useAccept, useFriends, useRemoveFriend } from '../../data/social';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Icon } from '../../design/components/Icon';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { PageHeader } from '../../shell/PageHeader';
import { useAddFriend } from '../../shell/AddFriendHost';
import { PersonAvatar, PersonText } from './parts';
import '../../design/social.css';

/** Friends (route /friends): requests to answer, requests you sent, then your friends. */
export function FriendsScreen() {
  const { data, isPending, isError, refetch } = useFriends();
  const addFriend = useAddFriend();
  const accept = useAccept();
  const remove = useRemoveFriend();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>, done: string | null, failed: string) {
    setBusy(id);
    try {
      await fn();
      if (done) toast.show(done);
    } catch {
      toast.show(failed);
    } finally {
      setBusy(null);
    }
  }

  const header = <PageHeader title="Friends" backTo="/profile" backUsesHistory />;
  if (isPending) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        {header}
        <div className="screen__body stack-10"><Skeleton height={64} /><Skeleton height={64} /><Skeleton height={64} /></div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="screen">
        {header}
        <div className="screen__body">
          <EmptyState icon="info" title="Couldn't load your friends" body="Check your connection and try again."
            actionLabel="Retry" onAction={() => void refetch()} />
        </div>
      </div>
    );
  }
  const { friends, incoming, outgoing } = data;
  const hasRequests = incoming.length + outgoing.length > 0;
  if (friends.length === 0 && !hasRequests) {
    return (
      <div className="screen">
        {header}
        <div className="screen__body">
          <EmptyState icon="user" title="No friends yet" body="Add a friend to see what they rate."
            actionLabel="Add friend" onAction={addFriend} />
        </div>
      </div>
    );
  }
  return (
    <div className="screen">
      {header}
      <div className="screen__body social-page">
        {hasRequests && (
          <section aria-labelledby="friends-requests" className="group">
            <h2 id="friends-requests" className="group__title">Requests</h2>
            <ul className="people plain-list">
              {incoming.map((u) => (
                <li key={u.id} className="person">
                  <PersonAvatar user={u} />
                  <span className="person__meta">
                    <span className="person__name">@{u.username}</span>
                    <span className="person__sub">Wants to be friends</span>
                  </span>
                  <span className="person__actions">
                    <Button variant="primary" compact aria-label={`Accept @${u.username}`} disabled={busy === u.id}
                      onClick={() => void run(u.id, () => accept.mutateAsync(u.id), `You and @${u.username} are friends`, "Couldn't accept. Try again.")}>Accept</Button>
                    <Button compact aria-label={`Decline @${u.username}`} disabled={busy === u.id}
                      onClick={() => void run(u.id, () => remove.mutateAsync(u.id), null, "Couldn't decline. Try again.")}>Decline</Button>
                  </span>
                </li>
              ))}
              {outgoing.map((u) => (
                <li key={u.id} className="person">
                  <PersonAvatar user={u} />
                  <span className="person__meta">
                    <span className="person__name">@{u.username}</span>
                    <span className="person__sub">Requested</span>
                  </span>
                  <Button compact aria-label={`Cancel request to @${u.username}`} disabled={busy === u.id}
                    onClick={() => void run(u.id, () => remove.mutateAsync(u.id), null, "Couldn't cancel. Try again.")}>Cancel</Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {friends.length > 0 && (
          <section aria-labelledby="friends-list" className="group">
            <h2 id="friends-list" className="group__title">Friends · {friends.length}</h2>
            <ul className="people people--joined plain-list">
              {friends.map((u) => (
                <li key={u.id}>
                  <Link to={`/u/${u.username}`} className="person">
                    <PersonAvatar user={u} />
                    <PersonText user={u} />
                    <span className="group__chev"><Icon name="chevron" size={18} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Button variant="primary" className="social-add" onClick={addFriend}>Add friend</Button>
      </div>
    </div>
  );
}
