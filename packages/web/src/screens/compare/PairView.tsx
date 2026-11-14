import { formatRating, type Answer, type CompareItem, type Question } from '@media-tracker/shared';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '../../design/components/Button';
import { CoverBackdrop } from '../../design/components/CoverBackdrop';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';

export interface PairViewProps {
  question: Question;
  /** The question's items after the flip. */
  left: CompareItem;
  right: CompareItem;
  canBack: boolean;
  onAnswer(a: Answer): void;
  onBack(): void;
  wide: boolean;
}

/** Swipe (Ruling P5): at least this far sideways, and more than twice as far as up or down. */
const SWIPE_PX = 60;
/** A click this soon after a swipe is that swipe's own pointer-up, not a tap. */
const SWIPE_CLICK_MS = 500;

const KEYS: Record<string, 'L' | 'R' | 'same' | 'skip' | 'back'> = {
  ArrowLeft: 'L', ArrowRight: 'R', ArrowDown: 'same', s: 'skip', S: 'skip', Backspace: 'back',
};

const isTextField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

const ratingLine = (x: CompareItem) => (x.rating === null ? 'not rated yet' : `now ${formatRating(x.rating)}`);

/** "Going through 3 of 43 · …" / "Unrated 1 of 2" → a progress fraction; placing a new rating has none. */
function fraction(progress: string): number | null {
  const m = /(\d+) of (\d+)/.exec(progress);
  if (!m) return null;
  const n = Number(m[1]), total = Number(m[2]);
  return total > 0 ? Math.min(1, n / total) : null;
}

/** One Compare question: two cards (tap, arrow keys or swipe), Back / About the same / Skip / Stop and review. */
export function PairView({ question, left, right, canBack, onAnswer, onBack, wide }: PairViewProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const side = (s: 'L' | 'R'): Answer => ((s === 'L' ? left : right).id === question.a.id ? 'a' : 'b');

  // Screen readers announce each new question: focus moves to its heading.
  useEffect(() => { heading.current?.focus(); }, [question]);

  const latest = useRef({ side, onAnswer, onBack, canBack });
  latest.current = { side, onAnswer, onBack, canBack };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
      const k = KEYS[e.key];
      if (!k) return;
      e.preventDefault();
      const p = latest.current;
      if (k === 'back') { if (p.canBack) p.onBack(); }
      else if (k === 'L' || k === 'R') p.onAnswer(p.side(k));
      else p.onAnswer(k);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const down = useRef<{ x: number; y: number } | null>(null);
  const swipedAt = useRef(0);
  const onPointerDown = (e: ReactPointerEvent) => { down.current = { x: e.clientX, y: e.clientY }; swipedAt.current = 0; };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= 2 * Math.abs(dy)) return;
    swipedAt.current = Date.now();
    onAnswer(side(dx < 0 ? 'L' : 'R'));
  };
  const tap = (s: 'L' | 'R') => {
    if (swipedAt.current && Date.now() - swipedAt.current < SWIPE_CLICK_MS) return;
    onAnswer(side(s));
  };

  // A new question remounts the cards, so they slide in again.
  const qKey = `${question.a.id}|${question.b.id}|${question.progress}`;
  const card = (x: CompareItem, s: 'L' | 'R') => (
    <button key={`${s}|${x.id}|${qKey}`} type="button" className={`pick pick--${s === 'L' ? 'l' : 'r'} has-backdrop`}
      aria-label={`${x.title}, ${ratingLine(x)}`} onClick={() => tap(s)}>
      <CoverBackdrop src={x.cover} className="backdrop--card" />
      <span className="pick__cover" aria-hidden="true">
        <CoverImage src={x.cover} alt={`${x.title} cover`} square={x.square} width={wide ? 246 : 160} fluid />
      </span>
      <span className="pick__name">{x.title}</span>
      <span className="pick__now">
        {x.rating === null
          ? <span className="rating rating--xs rating--none pick__unrated">not rated yet</span>
          : <>now <RatingBadge rating={x.rating} size="xs" /></>}
      </span>
    </button>
  );

  const frac = fraction(question.progress);
  return (
    <div className={wide ? 'compare-ask compare-ask--wide' : 'compare-ask'}>
      <div className="compare__head">
        <h1 ref={heading} tabIndex={-1} className="compare__title">{question.title}</h1>
        <span className="compare__sub">Which one do you think is better? {wide ? 'Click it.' : 'Tap it.'}</span>
      </div>
      <div role="group" aria-label="Pick the better one" className="duel"
        onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { down.current = null; }}>
        {card(left, 'L')}
        {card(right, 'R')}
      </div>
      <div className="compare__actions">
        <Button onClick={onBack} disabled={!canBack}>← Back</Button>
        <Button onClick={() => onAnswer('same')}>About the same</Button>
        <Button onClick={() => onAnswer('skip')}>Skip</Button>
        <Button onClick={() => onAnswer('stop')}>Stop and review</Button>
      </div>
      <div className="compare__progress">
        {frac !== null && (
          <div className="compare__bar" aria-hidden="true">
            <span key={question.progress} style={{ width: `${Math.round(frac * 100)}%` }} />
          </div>
        )}
        <span>{question.progress}</span>
      </div>
      {wide && (
        <span className="compare__keys">
          Keyboard: <kbd>←</kbd> left · <kbd>→</kbd> right · <kbd>↓</kbd> same · <kbd>S</kbd> skip · <kbd>Backspace</kbd> back
        </span>
      )}
    </div>
  );
}
