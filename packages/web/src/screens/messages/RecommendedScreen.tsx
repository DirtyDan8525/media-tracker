import { nameOf } from '@media-tracker/shared';
import { useRecommended } from '../../data/messages';
import { EmptyState } from '../../design/components/EmptyState';
import { Skeleton } from '../../design/components/Skeleton';
import { useNow } from '../../hooks';
import { PageHeader } from '../../shell/PageHeader';
import { RecCard } from './RecCard';
import { ageText } from './format';
import '../../design/messages.css';

/** Recommended to you (route /messages/recommended): the recs you were sent, newest first, each with Add to mine. */
export function RecommendedScreen() {
  const recs = useRecommended();
  const now = useNow();
  const header = <PageHeader title="Recommended to you" backTo="/messages" backUsesHistory />;
  if (recs.isPending) {
    return <div className="screen" aria-busy="true" aria-label="Loading">{header}<div className="screen__body stack-10"><Skeleton height={120} /><Skeleton height={120} /></div></div>;
  }
  if (recs.isError || !recs.data) {
    return <div className="screen">{header}<div className="screen__body"><EmptyState icon="info" title="Couldn't load your recommendations" body="Check your connection and try again." actionLabel="Retry" onAction={() => void recs.refetch()} /></div></div>;
  }
  if (recs.data.length === 0) {
    return <div className="screen">{header}<div className="screen__body"><EmptyState icon="share" title="Nothing recommended yet" body="When a friend recommends a title, it shows here." /></div></div>;
  }
  return (
    <div className="screen">
      {header}
      <div className="screen__body stack-10 rec-list">
        <ul className="plain-list stack-10" aria-label="Recommended to you">
          {recs.data.map(({ message, sender }) => (
            <li key={message.id} className="rec-item">
              <span className="rec-item__from">from @{sender.username} · {ageText(message.createdAt, now)}</span>
              {message.rec && <RecCard rec={message.rec} senderName={nameOf(sender)} note={message.text} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
