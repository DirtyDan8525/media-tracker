import { COMMENT_MAX, nameOf, type Comment, type Target } from '@media-tracker/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';
import { useComments, useDeleteComment, usePostComment } from '../../data/feed';
import { timeAgo } from '../activity/format';
import { useNow } from '../../hooks';
import { useMe } from '../../data/useMe';
import '../../design/feed.css';

/** The comment thread of one post or entry: oldest first, a composer pinned under it. */
export function CommentsSheet({ target, open, onClose }: { target: Target; open: boolean; onClose: () => void }) {
  const comments = useComments(open ? target : null);
  const post = usePostComment();
  const toast = useToast();
  const [text, setText] = useState('');
  const left = COMMENT_MAX - text.length;
  const body = text.trim();
  const canPost = body.length > 0 && left >= 0 && !post.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    post.mutate({ target, body }, {
      onSuccess: () => setText(''),
      onError: () => toast.show("Couldn't post your comment. Try again."),
    });
  }

  const footer = (
    <form className="comment-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="comment-text">Add a comment</label>
      <textarea id="comment-text" className="comment-form__input" rows={2} value={text} placeholder="Add a comment"
        aria-describedby="comment-left" onChange={(e) => setText(e.target.value)} />
      <div className="comment-form__row">
        <span id="comment-left" role="status" className={`comment-form__left${left < 0 ? ' is-over' : ''}`}>
          {left >= 0 ? `${left} left` : `${-left} over`}
        </span>
        <Button type="submit" variant="primary" disabled={!canPost}>Post</Button>
      </div>
    </form>
  );

  return (
    <Sheet open={open} title="Comments" onClose={onClose} footer={footer}>
      {comments.isPending ? (
        <p className="comment-empty" aria-busy="true">Loading comments…</p>
      ) : comments.isError ? (
        <p className="comment-empty">
          Couldn't load comments. <button type="button" className="link-btn" onClick={() => void comments.refetch()}>Try again</button>
        </p>
      ) : comments.data.length === 0 ? (
        <p className="comment-empty">No comments yet. Say something kind.</p>
      ) : (
        <ul className="plain-list comment-list">
          {comments.data.map((c) => <CommentRow key={c.id} comment={c} target={target} />)}
        </ul>
      )}
    </Sheet>
  );
}

function CommentRow({ comment, target }: { comment: Comment; target: Target }) {
  const del = useDeleteComment();
  const toast = useToast();
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const who = nameOf(comment.author);
  // The admin may delete any comment (AD7); everyone else, what the server says.
  const admin = useMe().data?.isAdmin === true;
  const canDelete = comment.canDelete || admin;
  return (
    <li className="comment">
      <div className="comment__head">
        <strong>{who}</strong>
        <time dateTime={comment.createdAt}>{timeAgo(comment.createdAt, now)}</time>
      </div>
      <p className="comment__body">{comment.body}</p>
      {canDelete && !asking && (
        <button type="button" className="link-btn comment__delete" aria-label={`Delete comment by ${who}`} onClick={() => setAsking(true)}>
          Delete
        </button>
      )}
      {asking && (
        <div className="comment__confirm" role="group" aria-label="Delete this comment?">
          <span>Delete this comment?</span>
          <Button compact variant="primary" disabled={del.isPending}
            onClick={() => del.mutate({ target, id: comment.id }, { onError: () => { setAsking(false); toast.show("Couldn't delete the comment. Try again."); } })}>
            Delete
          </Button>
          <Button compact variant="secondary" onClick={() => setAsking(false)}>Keep</Button>
        </div>
      )}
    </li>
  );
}
