import { useId } from 'react';

export interface SegRadioProps<T extends string> {
  /** The group's accessible name. */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** CSS block: 'seg' (a joined bar) or 'activity-filter' (separate chips). */
  block?: 'seg' | 'activity-filter';
  /** Extra class on the group (e.g. 'seg--auto': a normal-width control on PC instead of full width). */
  className?: string;
}

/**
 * A radio group made of real `<input type="radio">`s, so the browser gives it the arrow-key
 * behaviour and roving focus a radiogroup needs. The input covers its label (the whole option is
 * the tap target) and is invisible; the label draws the state.
 */
export function SegRadio<T extends string>({ label, value, options, onChange, block = 'seg', className }: SegRadioProps<T>) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={className ? `${block} ${className}` : block}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label key={o.value} className={on ? `${block}__opt ${block}__opt--on` : `${block}__opt`}>
            <input type="radio" className={`${block}__input`} name={name} value={o.value} checked={on}
              onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
