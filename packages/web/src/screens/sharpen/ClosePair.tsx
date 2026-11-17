import { formatRating, type SetItem } from '@media-tracker/shared';
import { useEffect, useRef } from 'react';
import { Button } from '../../design/components/Button';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';
import '../../design/compare.css';

export type CloseAnswer = 'a' | 'b' | 'same' | 'skip';
export type PairCard = Pick<SetItem, 'id' | 'title' | 'rating' | 'cover' | 'square'>;

const KEYS: Record<string, CloseAnswer> = { ArrowLeft: 'a', ArrowRight: 'b', ArrowDown: 'same', s: 'skip', S: 'skip' };
const isTextField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

/**
 * One close call (RateClose / Sharpen boards): "Which did you like more?", two cover cards, About
 * the same. Arrow keys ← → pick a side, ↓ is About the same, S skips. `busy` disables answering
 * while a pick saves.
 */
export function ClosePair({ a, b, onAnswer, busy, wide }: {
  a: PairCard; b: PairCard; onAnswer: (x: CloseAnswer) => void; busy: boolean; wide: boolean;
}) {
  const latest = useRef({ onAnswer, busy });
  latest.current = { onAnswer, busy };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
      const k = KEYS[e.key];
      if (!k || latest.current.busy) return;
      e.preventDefault();
      latest.current.onAnswer(k);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const card = (x: PairCard, side: 'a' | 'b') => (
    <div key={`${side}|${x.id}`} className={`pick-col pick-col--${side === 'a' ? 'l' : 'r'}`}>
      <button type="button" className={`pick pick--${side === 'a' ? 'l' : 'r'}`} disabled={busy}
        aria-label={`${x.title}, ${x.rating === null ? 'not rated' : formatRating(x.rating)}`} onClick={() => onAnswer(side)}>
        <span className="pick__cover" aria-hidden="true">
          <CoverImage src={x.cover} alt={`${x.title} cover`} square={x.square} width={wide ? 200 : 140} fluid />
        </span>
        <span className="pick__name">{x.title}</span>
        <span className="pick__now"><RatingBadge rating={x.rating} size="xs" /></span>
      </button>
    </div>
  );

  return (
    <div className="close-pair">
      <p className="compare__sub close-pair__q">Which did you like more?</p>
      <div role="group" aria-label="Which did you like more?" className="duel">
        {card(a, 'a')}
        {card(b, 'b')}
      </div>
      <Button className="btn--block" disabled={busy} onClick={() => onAnswer('same')}>About the same</Button>
      {wide && (
        <span className="compare__keys">
          Keyboard: <kbd>←</kbd> left · <kbd>→</kbd> right · <kbd>↓</kbd> about the same · <kbd>S</kbd> skip
        </span>
      )}
    </div>
  );
}
