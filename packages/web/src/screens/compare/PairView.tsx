import { formatRating, type Tier } from '@media-tracker/shared';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '../../design/components/Button';
import { CoverBackdrop } from '../../design/components/CoverBackdrop';
import { CoverImage } from '../../design/components/CoverImage';
import { ProgressBar } from '../../design/components/ProgressBar';
import { RatingBadge } from '../../design/components/RatingBadge';
import { MoveMenu } from './MoveMenu';

/** What a question card shows about a title. */
export interface PairItem {
  id: string;
  title: string;
  rating: number | null;
  tier: Tier | null;
  cover: string;
  square: boolean;
}

export type PairAnswer = 'a' | 'b' | 'same' | 'skip' | 'stop';

export interface PairViewProps {
  /** "Fix my ratings", "Place it", … */
  heading: string;
  /** "Anime · Loved" */
  sub?: string;
  /** The question's first title ("a"); the cards may be flipped. */
  aId: string;
  left: PairItem;
  right: PairItem;
  /** "Pick 3", "Placing Frieren · pick 2 of about 4" */
  progress: string;
  canBack: boolean;
  onAnswer(a: PairAnswer): void;
  onBack(): void;
  wide: boolean;
  /** The settledness bar (Fix my ratings). */
  settled?: { checked: number; total: number };
  /** Tier names and range labels, indexed by tier. */
  tierNames: readonly string[];
  tierRanges?: readonly string[];
  /** "Belongs in another tier". */
  onMove(id: string, tier: Tier): void;
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
const inMenu = (t: EventTarget | null): boolean => t instanceof Element && t.closest('[role="menu"]') !== null;

const ratingLine = (x: PairItem) => (x.rating === null ? 'not rated yet' : `now ${formatRating(x.rating)}`);

/** One question: two cards (tap, arrow keys or swipe), each with "Belongs in another tier"; Back / About the same / Skip / Stop. */
export function PairView({
  heading, sub, aId, left, right, progress, canBack, onAnswer, onBack, wide, settled, tierNames, tierRanges, onMove,
}: PairViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [menuFor, setMenuFor] = useState<'L' | 'R' | null>(null);
  const moveBtn = { L: useRef<HTMLButtonElement>(null), R: useRef<HTMLButtonElement>(null) };
  const side = (s: 'L' | 'R'): PairAnswer => ((s === 'L' ? left : right).id === aId ? 'a' : 'b');

  // A new question remounts the cards (they slide in again) and screen readers hear its heading.
  const qKey = `${left.id}|${right.id}|${progress}`;
  // The heading is the same on every question, so a polite live region says what is new.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    setMenuFor(null);
    headingRef.current?.focus();
    setAnnounce(`${left.title} or ${right.title}. ${progress}`);
  }, [qKey]);
  const settledText = settled ? `${settled.checked} of ${settled.total} neighbours checked` : '';

  const latest = useRef({ side, onAnswer, onBack, canBack });
  latest.current = { side, onAnswer, onBack, canBack };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target) || inMenu(e.target)) return;
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
  const onPointerDown = (e: ReactPointerEvent) => {
    if (inMenu(e.target)) return;
    down.current = { x: e.clientX, y: e.clientY };
    swipedAt.current = 0;
  };
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

  const closeMenu = (s: 'L' | 'R') => {
    setMenuFor(null);
    moveBtn[s].current?.focus();
  };

  const column = (x: PairItem, s: 'L' | 'R') => (
    <div key={`${s}|${x.id}|${qKey}`} className={`pick-col pick-col--${s === 'L' ? 'l' : 'r'}`}>
      <button type="button" className={`pick pick--${s === 'L' ? 'l' : 'r'} has-backdrop`}
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
        {x.tier !== null && <span className="pick__tier">Tier: {tierNames[x.tier]}</span>}
      </button>
      <div className="pick-move">
        <button ref={moveBtn[s]} type="button" className="btn btn--ghost btn--compact pick-move__btn"
          aria-haspopup="menu" aria-expanded={menuFor === s} aria-label={`Belongs in another tier: ${x.title}`}
          onClick={() => setMenuFor(menuFor === s ? null : s)}>
          Belongs in another tier <span aria-hidden="true">▾</span>
        </button>
        {menuFor === s && (
          <MoveMenu title={x.title} current={x.tier} names={tierNames} ranges={tierRanges} anchor={moveBtn[s]}
            onClose={() => closeMenu(s)}
            onPick={(t) => { setMenuFor(null); onMove(x.id, t); }} />
        )}
      </div>
    </div>
  );

  return (
    <div className={wide ? 'compare-ask compare-ask--wide' : 'compare-ask'}>
      <div className="compare__head">
        <h1 ref={headingRef} tabIndex={-1} className="compare__title">{heading}</h1>
        {sub && <span className="compare__context">{sub}</span>}
      </div>
      {settled && (
        <div className="compare__settled">
          {/* With nothing to check the order is as settled as it gets: a full bar. */}
          {settled.total > 0
            ? <ProgressBar label="Neighbours checked" value={settled.checked} max={settled.total} valueText={settledText} />
            : <ProgressBar label="Neighbours checked" value={1} max={1} valueText={settledText} />}
          <span>{settledText}</span>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">{announce}</span>
      <span className="compare__sub">Which do you like more? {wide ? 'Click it.' : 'Tap it.'}</span>
      <div role="group" aria-label="Pick the better one" className="duel"
        onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { down.current = null; }}>
        {column(left, 'L')}
        {column(right, 'R')}
      </div>
      <div className="compare__actions">
        <Button onClick={onBack} disabled={!canBack}>← Back</Button>
        <Button onClick={() => onAnswer('same')}>About the same</Button>
        <Button onClick={() => onAnswer('skip')}>Skip</Button>
        <Button onClick={() => onAnswer('stop')}>Stop and review</Button>
      </div>
      <div className="compare__progress"><span>{progress}</span></div>
      {wide && (
        <span className="compare__keys">
          Keyboard: <kbd>←</kbd> left · <kbd>→</kbd> right · <kbd>↓</kbd> same · <kbd>S</kbd> skip · <kbd>Backspace</kbd> back
        </span>
      )}
    </div>
  );
}
