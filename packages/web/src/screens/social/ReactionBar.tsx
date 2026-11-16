import { isReaction, REACTIONS, type PostSocial, type Reaction } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../design/components/Button';
import '../../design/feed.css';

/**
 * The reaction summary (FeedV2.wf): one chip per emoji that has at least one reaction, the count
 * beside it, `aria-pressed` for yours; a tap toggles yours. Renders nothing when nobody reacted.
 * The parent owns the (optimistic) state.
 */
export function ReactionChips({ social, onToggle, disabled }: {
  social: PostSocial;
  onToggle: (emoji: Reaction) => void;
  disabled?: boolean;
}) {
  const shown = Object.entries(social.reactions).filter(([, n]) => n > 0);
  if (shown.length === 0) return null;
  return (
    <div role="group" aria-label="Reactions" className="reactions">
      {shown.map(([emoji, count]) => (
        <button key={emoji} type="button" className="reactions__chip" aria-label={`${emoji} ${count}`} aria-pressed={social.mine.includes(emoji)}
          disabled={disabled} onClick={() => onToggle(emoji)}>
          <span aria-hidden="true">{emoji}</span>
          <span aria-hidden="true">{count}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * "React": opens a small popover with the six quick emojis and a "+" that swaps in a text field
 * ("Type any emoji", Add). Not modal: focus moves in on open, arrows move along the emojis, Escape
 * or a pick closes it and puts focus back on the button, and so does leaving it with Tab.
 */
export function ReactButton({ mine, onPick, disabled }: { mine: readonly Reaction[]; onPick: (emoji: Reaction) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    setTyping(false);
    setText('');
    setError(false);
    if (refocus) btn.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    if (typing) field.current?.focus();
    else pop.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open, typing]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) close(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function pick(emoji: string) {
    onPick(emoji);
    close(true);
  }
  function add() {
    const value = text.trim();
    if (!isReaction(value)) { setError(true); field.current?.focus(); return; }
    pick(value);
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
    if (!typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const items = [...(pop.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      e.preventDefault();
      items[(at + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }

  return (
    <span className="react" ref={root} onKeyDown={onKeyDown}
      onBlur={(e) => { if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) close(false); }}>
      <Button ref={btn} variant="secondary" className="react__btn" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} onClick={() => (open ? close(true) : setOpen(true))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M8 14c1 2 7 2 8 0M9 9.5h.01M15 9.5h.01" />
        </svg>
        React
      </Button>
      {open && (
        <div id={id} ref={pop} role="dialog" aria-label="Pick a reaction" className="react__pop">
          {typing ? (
            <form className="react__form" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <label className="sr-only" htmlFor={`${id}-t`}>Type any emoji</label>
              <input id={`${id}-t`} ref={field} className="react__input" type="text" inputMode="text" autoComplete="off" placeholder="Type any emoji"
                value={text} aria-invalid={error || undefined} aria-describedby={error ? `${id}-e` : undefined}
                onChange={(e) => { setText(e.target.value); setError(false); }} />
              <Button type="submit" variant="primary">Add</Button>
              {error && <p id={`${id}-e`} role="alert" className="react__error">Just one emoji, please.</p>}
            </form>
          ) : (
            <>
              {REACTIONS.map((emoji) => (
                <button key={emoji} type="button" className="react__emoji" aria-label={emoji} aria-pressed={mine.includes(emoji)} onClick={() => pick(emoji)}>
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
              <button type="button" className="react__emoji react__plus" aria-label="More emojis" onClick={() => setTyping(true)}>
                <span aria-hidden="true">+</span>
              </button>
            </>
          )}
        </div>
      )}
    </span>
  );
}
