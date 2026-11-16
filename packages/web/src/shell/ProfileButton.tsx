import { Link } from 'react-router';
import { useUnread } from '../data/feed';
import { Avatar } from '../design/components/Avatar';
import { useIsWide } from '../hooks';
import { useSessionMe } from './SessionGate';

/**
 * B9: the round profile button (44 px, your photo or initial) at the top right of every main phone
 * screen; it opens Profile. Renders nothing on PC, where the side nav's first row is the profile link.
 */
export function ProfileButton() {
  const me = useSessionMe();
  const wide = useIsWide();
  const requests = useUnread().data?.requests ?? 0;
  if (wide) return null;
  return (
    <Link to="/profile" className="profile-btn" aria-label={requests > 0 ? `Profile, ${requests} friend ${requests === 1 ? 'request' : 'requests'}` : 'Profile'}>
      <Avatar me={me} size={40} />
      {requests > 0 && <span className="nav-dot" aria-hidden="true" />}
    </Link>
  );
}
