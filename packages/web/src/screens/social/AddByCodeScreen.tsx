import { useNavigate, useParams, Link } from 'react-router';
import { ApiError } from '../../api/client';
import { useAddByCode, useCodeOwner, useFriends } from '../../data/social';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { PersonAvatar } from './parts';
import '../../design/social.css';

/** /add/<code>: the link a friend sent. Brand-new users get here after username setup. */
export function AddByCodeScreen() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const owner = useCodeOwner(code);
  const friends = useFriends();
  const add = useAddByCode();

  if (owner.isPending) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        <div className="add-code"><div className="add-code__card"><Skeleton width={56} height={56} /><Skeleton width={200} height={24} /><Skeleton height={56} /></div></div>
      </div>
    );
  }
  if (owner.isError || !owner.data) {
    const err = owner.error;
    const own = err instanceof ApiError && err.error === 'self';
    const gone = err instanceof ApiError && err.status === 404;
    return (
      <div className="screen">
        <div className="screen__body">
          {own ? (
            <EmptyState icon="info" title="That's your own link" body="Send it to a friend so they can add you." actionLabel="Go to Friends" actionHref="/friends" />
          ) : gone ? (
            <EmptyState icon="info" title="This link no longer works" body="Ask your friend for a new one, or find them by username." actionLabel="Go to Friends" actionHref="/friends" />
          ) : (
            <EmptyState icon="info" title="Couldn't open this link" body="Check your connection and try again."
              actionLabel="Retry" onAction={() => void owner.refetch()} />
          )}
        </div>
      </div>
    );
  }
  const user = owner.data;
  const already = friends.data?.friends.some((f) => f.id === user.id) ?? false;

  async function onAdd() {
    try {
      await add.mutateAsync(code);
      toast.show(`You and @${user.username} are friends`);
      navigate(`/u/${user.username}`, { replace: true });
    } catch {
      toast.show("Couldn't add them. Try again.");
    }
  }

  return (
    <div className="screen">
      <div className="add-code">
        <div className="add-code__card">
          <PersonAvatar user={user} size={64} />
          {already ? (
            <>
              <h1>You and @{user.username} are already friends</h1>
              <Link to={`/u/${user.username}`} className="btn btn--primary">See their lists</Link>
            </>
          ) : (
            <>
              <h1>Add @{user.username} as a friend?</h1>
              <Button variant="primary" disabled={add.isPending} onClick={() => void onAdd()}>{add.isPending ? 'Adding…' : 'Add'}</Button>
              <Button variant="ghost" onClick={() => navigate('/', { replace: true })}>Not now</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
