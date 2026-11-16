import { Icon } from '../../design/components/Icon';
import '../../design/feed.css';

/** The lock on a private row: the icon is the label ("Private"), so it also reads for screen readers. */
export function PrivateLock() {
  return (
    <span className="private-lock" role="img" aria-label="Private" title="Private">
      <Icon name="lock" size={14} />
    </span>
  );
}
