import { REACTIONS, type PostSocial, type Reaction } from '@media-tracker/shared';

/**
 * The six fixed reactions (Feed.wf): one 44 px toggle each, `aria-pressed` for yours, the count
 * beside the emoji when anyone reacted. The parent owns the (optimistic) state.
 */
export function ReactionBar({ social, onToggle, disabled }: {
  social: PostSocial;
  onToggle: (emoji: Reaction) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Reactions" className="reactions">
      {REACTIONS.map((emoji) => {
        const count = social.reactions[emoji] ?? 0;
        return (
          <button key={emoji} type="button" className="reactions__btn" aria-label={count > 0 ? `${emoji} ${count}` : emoji} aria-pressed={social.mine.includes(emoji)}
            disabled={disabled} onClick={() => onToggle(emoji)}>
            <span>{emoji}</span>
            {count > 0 && <span className="reactions__count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
