import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAccept, useFriends, useFriendsEntries, useRemoveFriend, type Friend } from '../../data/social';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Icon } from '../../design/components/Icon';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { useIsWide } from '../../hooks';
import { MessageFriendButton } from '../messages/MessageButton';
import { MessagesBubble } from '../messages/MessagesBubble';
import { PageHeader } from '../../shell/PageHeader';
import { useAddFriend } from '../../shell/AddFriendHost';
import { PersonAvatar, PersonText, who } from './parts';
import '../../design/social.css';

/**
 * Friends hub (route /friends, phone tab 4; FriendsHub / PCNav boards, option B): requests to answer and requests you sent, then your
 * friends. Phone: rows that open the profile, each with a round Message button; Add friend in the top bar and the floating
 * Messages bubble. PC: a grid of friend cards (Compare, Message) under a requests strip.
 */
export function FriendsScreen() {
  const { data, isPending, isError, refetch } = useFriends();
  const addFriend = useAddFriend();
  const accept = useAccept();
  const remove = useRemoveFriend();
  const toast = useToast();
  const wide = useIsWide();
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

  const header = (
    <PageHeader title="Friends" profile actions={<Button variant="primary" compact onClick={addFriend}><Icon name="plus" size={18} />Add friend</Button>} />
  );
  if (isPending) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        {header}
        <div className="screen__body stack-10"><Skeleton height={64} /><Skeleton height={64} /><Skeleton height={64} /></div>
        <MessagesBubble />
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
        <MessagesBubble />
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
          <EmptyState icon="user" title="No friends yet" body="Tap Add friend to see what they rate." />
        </div>
        <MessagesBubble />
      </div>
    );
  }
  return (
    <div className="screen">
      {header}
      <div className={`screen__body social-page${wide ? ' friends-page' : ''}`}>
        {hasRequests && (
          <section aria-labelledby="friends-requests" className="group">
            <h2 id="friends-requests" className="group__title">Requests{incoming.length > 0 ? ` · ${incoming.length}` : ''}</h2>
            <ul className="people plain-list friends-requests">
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
            {wide ? <FriendCards friends={friends} /> : (
              <ul className="people people--joined plain-list">
                {friends.map((u) => (
                  <li key={u.id} className="friend-row">
                    <Link to={`/u/${u.username}`} className="person" aria-label={`${who(u)}, open profile`}>
                      <PersonAvatar user={u} />
                      <PersonText user={u} />
                      <span className="group__chev"><Icon name="chevron" size={18} /></span>
                    </Link>
                    <MessageFriendButton user={u} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      {!wide && <MessagesBubble />}
    </div>
  );
}

/** PC: one card per friend, with how many titles of theirs you can see; Compare opens their profile's Compare tab. */
function FriendCards({ friends }: { friends: Friend[] }) {
  const theirs = useFriendsEntries();
  const titles = useMemo(() => new Map((theirs.data ?? []).map((f) => [f.userId, f.entries.length])), [theirs.data]);
  return (
    <ul className="friend-cards plain-list">
      {friends.map((u) => {
        const n = titles.get(u.id);
        return (
          <li key={u.id} className="friend-card">
            <Link to={`/u/${u.username}`} className="friend-card__id" aria-label={`${who(u)}, open profile`}>
              <PersonAvatar user={u} size={56} />
              <span className="friend-card__name">
                <b>{who(u)}</b>
                <span>@{u.username}</span>
              </span>
            </Link>
            {n !== undefined && <span className="friend-card__titles">{n} {n === 1 ? 'title' : 'titles'}</span>}
            <div className="friend-card__actions">
              <Link to={`/u/${u.username}?tab=compare`} className="btn btn--secondary btn--compact friend-card__btn" aria-label={`Compare with ${who(u)}`}>Compare</Link>
              <MessageFriendButton user={u} labelled />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
