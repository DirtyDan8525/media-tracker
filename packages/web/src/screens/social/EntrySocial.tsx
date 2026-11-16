import { useState } from 'react';
import { useEntrySocial, useReact } from '../../data/feed';
import { ReactionBar } from './ReactionBar';
import { CommentsSheet } from './CommentsSheet';
import '../../design/feed.css';

const NONE = { reactions: {}, mine: [], comments: 0 };

/**
 * Reactions and the comment thread on one entry (your own, or a friend's). Hidden when the thread
 * can't be read (the friend can no longer see the title). `ownerId` is the entry's owner; the server
 * decides who may delete a comment (`canDelete`).
 */
export function EntrySocial({ entryId, ownerId }: { entryId: string; ownerId: string }) {
  void ownerId;
  const social = useEntrySocial(entryId);
  const react = useReact();
  const [open, setOpen] = useState(false);
  const s = social.data ?? NONE;
  const target = { entryId } as const;
  return (
    <section className="entry-social" aria-label="Reactions and comments">
      <ReactionBar social={s} onToggle={(emoji) => react.mutate({ target, emoji })} />
      <button type="button" className="entry-social__comments" onClick={() => setOpen(true)}>
        {s.comments === 0 ? 'Comment' : s.comments === 1 ? '1 comment' : `${s.comments} comments`}
      </button>
      <CommentsSheet target={target} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
