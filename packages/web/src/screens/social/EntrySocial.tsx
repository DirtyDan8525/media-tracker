import { useState } from 'react';
import { useEntrySocial, useReact } from '../../data/feed';
import { Button } from '../../design/components/Button';
import { ReactButton, ReactionChips } from './ReactionBar';
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
      <ReactionChips social={s} onToggle={(emoji) => react.mutate({ target, emoji })} />
      <div className="entry-social__actions">
        <ReactButton mine={s.mine} onPick={(emoji) => react.mutate({ target, emoji })} />
        <Button variant="secondary" className="entry-social__comments" onClick={() => setOpen(true)}>
          {s.comments === 0 ? 'Comment' : `Comment (${s.comments})`}
        </Button>
      </div>
      <CommentsSheet target={target} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
