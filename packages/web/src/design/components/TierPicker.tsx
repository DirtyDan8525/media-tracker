import { tierRange, type Tier, type TierSet } from '@media-tracker/shared';

/** Tiers top first, as every tier list on screen shows them (Loved … Didn't like). */
export const TIERS_TOP_FIRST: readonly Tier[] = [3, 2, 1, 0];

const one = (x: number) => String(Math.round(x * 10) / 10);

/**
 * A tier's range as shown: "9–10" for the top tier, "7.5–8.9" below it (a shown score stays under
 * the next tier's lower bound).
 */
export function rangeLabel([low, high]: readonly [number, number], top: boolean): string {
  return `${one(low)}–${one(top ? high : high - 0.1)}`;
}

/** Every tier's range label, indexed by tier. */
export function tierRangeLabels(tiers: TierSet): string[] {
  return ([0, 1, 2, 3] as Tier[]).map((t) => rangeLabel(tierRange(tiers, t), t === 3));
}

export interface TierPickerProps {
  /** Tier names, indexed by tier. */
  names: readonly string[];
  /** Tier ranges [low, high], indexed by tier. */
  ranges: readonly (readonly [number, number])[];
  value: Tier | null;
  onPick(t: Tier): void;
  /** The group's name (default "Tier"). */
  label?: string;
}

/** Four large tier buttons, top tier first, each with its name and range ("Loved · 9–10"). */
export function TierPicker({ names, ranges, value, onPick, label = 'Tier' }: TierPickerProps) {
  return (
    <div role="group" aria-label={label} className="tier-picker">
      {TIERS_TOP_FIRST.map((t) => {
        const range = rangeLabel(ranges[t]!, t === 3);
        return (
          <button key={t} type="button" className={value === t ? 'tier-btn is-on' : 'tier-btn'} aria-pressed={value === t}
            aria-label={`${names[t]} · ${range}`} onClick={() => onPick(t)}>
            <span className="tier-btn__name">{names[t]}</span>
            <small className="tier-btn__range">{range}</small>
          </button>
        );
      })}
    </div>
  );
}
