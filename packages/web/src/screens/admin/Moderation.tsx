import { nameOf } from '@media-tracker/shared';
import { useState } from 'react';
import type { AdminComment } from '../../api/adminTypes';
import { useAdminComments, useAdminDeleteComment } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Sheet } from '../../design/components/Sheet';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { commentImageUrl } from '../../data/feed';
import { useNow } from '../../hooks';
import { timeAgo } from '../activity/format';
import { PlainPage } from './parts';

/** /admin/moderation (AD7): the newest comments from anyone, each with Delete (after a confirm). */
export function ModerationScreen() {
  const q = useAdminComments();
  const del = useAdminDeleteComment();
  const toast = useToast();
  const now = useNow();
  const [asking, setAsking] = useState<AdminComment | null>(null);

  async function confirm() {
    if (!asking) return;
    try {
      await del.mutateAsync(asking.id);
      toast.show('Comment deleted');
      setAsking(null);
    } catch {
      toast.show("Couldn't delete that comment. Try again.");
    }
  }

  return (
    <PlainPage title="Moderation">
      <section aria-labelledby="mod-title" className="group">
        <h2 id="mod-title" className="group__title">Recent comments</h2>
        {q.isPending ? <div aria-busy="true" aria-label="Loading" className="stack-10"><Skeleton height={64} /><Skeleton height={64} /></div>
          : q.isError || !q.data ? <EmptyState icon="info" title="Couldn't load comments" body="Check your connection and try again." actionLabel="Retry" onAction={() => void q.refetch()} />
          : q.data.length === 0 ? <p className="friend-note">No comments yet.</p> : (
            <ul className="people plain-list">
              {q.data.map((c) => (
                <li key={c.id} className="person person--admin">
                  <span className="person__meta">
                    <span className="person__name">{nameOf(c.author)} <span className="muted">· {timeAgo(c.createdAt, now)}</span></span>
                    {c.body !== '' && <span className="admin-comment__body">{c.body}</span>}
                    {c.expired ? <span className="admin-comment__pic admin-comment__pic--gone">Picture expired</span>
                      : c.image && (
                        <span className="admin-comment__pic">
                          <img src={commentImageUrl(c.id)} alt="" loading="lazy" width={48} height={48} />
                          <span>📷 Picture</span>
                        </span>
                      )}
                    <span className="person__sub">on {c.title}{c.owner ? ` (@${c.owner})` : ''}</span>
                  </span>
                  <Button compact aria-label={`Delete comment by ${nameOf(c.author)}`} onClick={() => setAsking(c)}>Delete</Button>
                </li>
              ))}
            </ul>
          )}
      </section>
      <Sheet open={asking !== null} title="Delete this comment?" onClose={() => { if (!del.isPending) setAsking(null); }}
        footer={
          <div className="btn-stack">
            <Button className="btn--danger btn--big" disabled={del.isPending} onClick={() => void confirm()}>Delete comment</Button>
            <Button className="btn--big" disabled={del.isPending} onClick={() => setAsking(null)}>Cancel</Button>
          </div>
        }>
        {asking && <p className="hint">{nameOf(asking.author)}: {asking.body !== '' ? `“${asking.body}”` : asking.expired ? '(picture expired)' : '(picture only)'}. It disappears for everyone.</p>}
      </Sheet>
    </PlainPage>
  );
}
