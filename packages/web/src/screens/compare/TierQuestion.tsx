import type { Tier } from '@media-tracker/shared';
import { useEffect, useRef } from 'react';
import { Button } from '../../design/components/Button';
import { CoverImage } from '../../design/components/CoverImage';
import { TierPicker } from '../../design/components/TierPicker';
import type { PairItem } from './PairView';

export interface TierQuestionProps {
  item: PairItem;
  /** "Movies · 1 of 3 with no score" */
  context: string;
  names: readonly string[];
  ranges: readonly (readonly [number, number])[];
  canBack: boolean;
  onPick(t: Tier): void;
  onBack(): void;
  onSkip(): void;
  onStop(): void;
}

/** Rating a finished title with no score: first its tier ("Which tier is X in?"), then it is placed. */
export function TierQuestion({ item, context, names, ranges, canBack, onPick, onBack, onSkip, onStop }: TierQuestionProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [item.id]);
  return (
    <div className="compare-ask tier-q">
      <div className="tier-q__head">
        <span className="tier-q__cover" aria-hidden="true">
          <CoverImage src={item.cover} alt={`${item.title} cover`} square={item.square} width={72} />
        </span>
        <div className="compare__head">
          <h1 ref={heading} tabIndex={-1} className="compare__title">Which tier is {item.title} in?</h1>
          <span className="compare__context">{context}</span>
        </div>
      </div>
      <TierPicker names={names} ranges={ranges} value={null} onPick={onPick} />
      <div className="compare__actions">
        <Button onClick={onBack} disabled={!canBack}>← Back</Button>
        <Button onClick={onSkip}>Skip</Button>
        <Button className="compare__span" onClick={onStop}>Stop and review</Button>
      </div>
    </div>
  );
}
