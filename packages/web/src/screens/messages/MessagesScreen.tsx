import { Link } from 'react-router';
import { conversationTitle, useConversations, useRecommended } from '../../data/messages';
import { EmptyState } from '../../design/components/EmptyState';
import { Icon } from '../../design/components/Icon';
import { Skeleton } from '../../design/components/Skeleton';
import { useNow } from '../../hooks';
import { PageHeader } from '../../shell/PageHeader';
import { useSessionMe } from '../../shell/SessionGate';
import { ChatAvatar } from './ChatAvatar';
import { listTime, previewOf } from './format';
import '../../design/messages.css';

/** The Messages list (route /messages): your chats, newest first; polls every 30 s and on focus. */
export function MessagesScreen() {
  const me = useSessionMe();
  const list = useConversations();
  const recs = useRecommended();
  const now = useNow();
  const recCount = recs.data?.length ?? 0;
  const header = (
    <PageHeader title="Messages" profile actions={<Link to="/messages/new" className="btn btn--primary">New</Link>} />
  );
  if (list.isPending) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        {header}
        <div className="screen__body stack-10"><Skeleton height={64} /><Skeleton height={64} /><Skeleton height={64} /></div>
      </div>
    );
  }
  if (list.isError || !list.data) {
    return (
      <div className="screen">
        {header}
        <div className="screen__body">
          <EmptyState icon="info" title="Couldn't load your messages" body="Check your connection and try again." actionLabel="Retry" onAction={() => void list.refetch()} />
        </div>
      </div>
    );
  }
  return (
    <div className="screen">
      {header}
      <div className="screen__body stack-10 messages-page">
        <Link to="/messages/recommended" className="group__row messages-rec-link">
          <span className="group__row-start"><span className="tile-icon"><Icon name="share" size={18} /></span>Recommended to you{recCount > 0 ? ` · ${recCount}` : ''}</span>
          <span className="group__chev"><Icon name="chevron" size={18} /></span>
        </Link>
        {list.data.length === 0 ? (
          <EmptyState icon="messages" title="No messages yet" body="Chat with a friend, or start a group." actionLabel="Message a friend" actionHref="/messages/new" />
        ) : (
          <ul className="plain-list convo-list" aria-label="Chats">
            {list.data.map((c) => {
              const title = conversationTitle(c, me.id);
              const preview = previewOf(c, me.id);
              const when = c.last ? listTime(c.last.createdAt, now) : '';
              return (
                <li key={c.id}>
                  <Link to={`/messages/${c.id}`} className={`convo${c.unread ? ' is-unread' : ''}`}
                    aria-label={`${title}${c.unread ? ', unread' : ''}. ${preview}${when ? `, ${when}` : ''}`}>
                    <ChatAvatar conversation={c} meId={me.id} />
                    <span className="convo__meta">
                      <span className="convo__title">{title}</span>
                      <span className="convo__preview">{preview}</span>
                    </span>
                    <span className="convo__end">
                      <span className="convo__time">{when}</span>
                      {c.unread && <span className="nav-dot nav-dot--inline" aria-hidden="true" />}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
