import { COMMENT_MAX, nameOf, type Comment } from '@media-tracker/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../design/components/Button';
import { IconButton } from '../../design/components/IconButton';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';
import { useMediaOptions } from '../../data/appSettings';
import { commentErrorText, commentImageUrl, useComments, useDeleteComment, usePostComment, type SocialTarget } from '../../data/feed';
import { PHOTO_ACCEPT, PictureViewer, StagedPhotoPreview, usePhotoStaging } from '../../media/photoStaging';
import { timeAgo } from '../activity/format';
import { useNow } from '../../hooks';
import { useMe } from '../../data/useMe';
import '../../design/feed.css';

/** The comment thread of one title (opened from one of its posts or from its page: the same thread), oldest first, a composer pinned under it. */
export function CommentsSheet({ target, open, onClose }: { target: SocialTarget; open: boolean; onClose: () => void }) {
  const post = usePostComment();
  const toast = useToast();
  const [text, setText] = useState('');
  const left = COMMENT_MAX - text.length;
  const body = text.trim();
  // A photo or GIF waits here with a preview and a ✕, as in chat; Post sends it with the text (text is optional then).
  const { staged, stage, clear } = usePhotoStaging();
  const photos = useMediaOptions().photos;
  const fileInput = useRef<HTMLInputElement>(null);
  const canPost = (body.length > 0 || staged !== null) && left >= 0 && !post.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    post.mutate({ target, body, photo: staged?.blob ?? null }, {
      onSuccess: () => { setText(''); clear(); },
      onError: (err) => toast.show(commentErrorText(err)),
    });
  }

  const footer = (
    <form className="comment-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="comment-text">Add a comment</label>
      <textarea id="comment-text" className="comment-form__input" rows={2} value={text} placeholder="Add a comment"
        aria-describedby="comment-left" onChange={(e) => setText(e.target.value)} />
      {staged && <StagedPhotoPreview staged={staged} onRemove={clear} />}
      <div className="comment-form__row">
        {photos && (
          <>
            <IconButton label="Add a photo or GIF" icon="image" look="plain" onClick={() => fileInput.current?.click()} />
            <input ref={fileInput} type="file" accept={PHOTO_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="comment-photo-input"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void stage(f); }} />
          </>
        )}
        <span id="comment-left" role="status" className={`comment-form__left${left < 0 ? ' is-over' : ''}`}>
          {left >= 0 ? `${left} left` : `${-left} over`}
        </span>
        <Button type="submit" variant="primary" disabled={!canPost}>Post</Button>
      </div>
    </form>
  );

  return (
    <Sheet open={open} title="Comments" onClose={onClose} footer={footer}>
      <CommentList target={target} />
    </Sheet>
  );
}

/** The thread itself (loading, error, empty and the comments): the sheet shows it, and so does the Activity details panel. */
export function CommentList({ target }: { target: SocialTarget }) {
  const comments = useComments(target);
  if (comments.isPending) return <p className="comment-empty" aria-busy="true">Loading comments…</p>;
  if (comments.isError) {
    return (
      <p className="comment-empty">
        Couldn't load comments. <button type="button" className="link-btn" onClick={() => void comments.refetch()}>Try again</button>
      </p>
    );
  }
  if (comments.data.length === 0) return <p className="comment-empty">No comments yet. Say something kind.</p>;
  return (
    <ul className="plain-list comment-list">
      {comments.data.map((c) => <CommentRow key={c.id} comment={c} target={target} />)}
    </ul>
  );
}

function CommentRow({ comment, target }: { comment: Comment; target: SocialTarget }) {
  const del = useDeleteComment();
  const toast = useToast();
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const [viewing, setViewing] = useState(false);
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
      {comment.body !== '' && <p className="comment__body">{comment.body}</p>}
      {comment.expired ? (
        <p className="comment__expired">Picture expired</p>
      ) : comment.image && (
        <>
          <button type="button" className="comment__photo" aria-label={`Open picture from ${who} full size`} onClick={() => setViewing(true)}>
            <img src={commentImageUrl(comment.id)} alt={`Picture from ${who}`} loading="lazy" />
          </button>
          <PictureViewer src={viewing ? commentImageUrl(comment.id) : null} alt={`Picture from ${who}, full size`} onClose={() => setViewing(false)} />
        </>
      )}
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
