export interface ProgressBarProps {
  label: string;
  value: number;
  max: number;
  /** What the bar says in words, when the numbers alone don't (e.g. a full bar for 0 of 0). */
  valueText?: string;
}

/** A thin determinate bar. Its fill only animates when the user hasn't asked for reduced motion. */
export function ProgressBar({ label, value, max, valueText }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}
      {...(valueText !== undefined ? { 'aria-valuetext': valueText } : {})}>
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
