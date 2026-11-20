import { isReaction, REACTIONS, type PostSocial, type Reaction, type Target } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../design/components/Button';
import { WhoReactedButton } from './WhoReacted';
import { useMe } from '../../data/useMe';
import { useNoteRecentEmoji } from '../../data/recentEmoji';
import '../../design/feed.css';

/**
 * The reaction summary (FeedV2.wf): one chip per emoji that has at least one reaction, the count
 * beside it, `aria-pressed` for yours; a tap toggles yours. Renders nothing when nobody reacted.
 * The parent owns the (optimistic) state. With `who` (the post or entry, and its title) a "Who reacted"
 * button sits after the chips and opens the list of people.
 */
export function ReactionChips({ social, onToggle, disabled, who }: {
  social: PostSocial;
  onToggle: (emoji: Reaction) => void;
  disabled?: boolean;
  who?: { target: Target; title: string };
}) {
  const shown = Object.entries(social.reactions).filter(([, n]) => n > 0);
  if (shown.length === 0) return null;
  return (
    <>
    <div role="group" aria-label="Reactions" className="reactions">
      {shown.map(([emoji, count]) => (
        <button key={emoji} type="button" className="reactions__chip" aria-label={`${emoji} ${count}`} aria-pressed={social.mine.includes(emoji)}
          disabled={disabled} onClick={() => onToggle(emoji)}>
          <span aria-hidden="true">{emoji}</span>
          <span aria-hidden="true">{count}</span>
        </button>
      ))}
    </div>
    {who && <WhoReactedButton target={who.target} title={who.title} />}
    </>
  );
}

/**
 * The emoji picker inside every reaction popover and the chat's message menu: the six quick emojis and "+", then a "Recent"
 * row with your last 4 custom emojis (hidden when you have none). "+" swaps in a text field ("Type any emoji", Add). Arrow
 * keys move along the emojis. Picking an emoji you have not used here yet (one not in `mine`) records it as recent at once.
 */
export function EmojiPicker({ mine, onPick, autoFocus = true }: { mine: readonly Reaction[]; onPick: (emoji: Reaction) => void; autoFocus?: boolean }) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const recent = useMe().data?.recentEmoji ?? [];
  const noteRecent = useNoteRecentEmoji();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (typing) field.current?.focus();
    else if (autoFocus) root.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [typing, autoFocus]);

  function pick(emoji: string) {
    if (!mine.includes(emoji)) noteRecent(emoji);
    setTyping(false);
    setText('');
    onPick(emoji);
  }
  function add() {
    const value = text.trim();
    if (!isReaction(value)) { setError(true); field.current?.focus(); return; }
    pick(value);
  }
  function onKeyDown(e: KeyboardEvent) {
    if (typing || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('button.react__emoji') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    items[(at + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  if (typing) {
    return (
      <form className="react__form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <label className="sr-only" htmlFor={`${id}-t`}>Type any emoji</label>
        <input id={`${id}-t`} ref={field} className="react__input" type="text" inputMode="text" autoComplete="off" placeholder="Type any emoji"
          value={text} aria-invalid={error || undefined} aria-describedby={error ? `${id}-e` : undefined}
          onChange={(e) => { setText(e.target.value); setError(false); }} />
        <Button type="submit" variant="primary">Add</Button>
        {error && <p id={`${id}-e`} role="alert" className="react__error">Just one emoji, please.</p>}
      </form>
    );
  }
  const emojiButton = (emoji: string) => (
    <button key={emoji} type="button" className="react__emoji" aria-label={emoji} aria-pressed={mine.includes(emoji)} onClick={() => pick(emoji)}>
      <span aria-hidden="true">{emoji}</span>
    </button>
  );
  return (
    <div className="react__picker" ref={root} onKeyDown={onKeyDown}>
      <div className="react__row" role="group" aria-label="Reactions">
        {REACTIONS.map(emojiButton)}
        <button type="button" className="react__emoji react__plus" aria-label="More emojis" onClick={() => setTyping(true)}>
          <span aria-hidden="true">+</span>
        </button>
      </div>
      {recent.length > 0 && (
        <div className="react__row react__recent" role="group" aria-labelledby={`${id}-r`}>
          <span id={`${id}-r`} className="react__recent-label">Recent</span>
          {recent.map(emojiButton)}
        </div>
      )}
    </div>
  );
}

/**
 * "React": opens a small popover with the picker (EmojiPicker). Not modal: focus moves in on open, Escape or a pick closes
 * it and puts focus back on the button, and so does leaving it with Tab.
 */
export function ReactButton({ mine, onPick, disabled }: { mine: readonly Reaction[]; onPick: (emoji: Reaction) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) close(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  return (
    <span className="react" ref={root} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(true); } }}
      onBlur={(e) => { if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) close(false); }}>
      <button ref={btn} type="button" className="btn btn--secondary react__btn" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} onClick={() => (open ? close(true) : setOpen(true))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M8 14c1 2 7 2 8 0M9 9.5h.01M15 9.5h.01" />
        </svg>
        React
      </button>
      {open && (
        <div id={id} role="dialog" aria-label="Pick a reaction" className="react__pop">
          <EmojiPicker mine={mine} onPick={(e) => { onPick(e); close(true); }} />
        </div>
      )}
    </span>
  );
}
