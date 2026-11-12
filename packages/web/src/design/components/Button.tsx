import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'chip';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Chips: highlighted (selected) state. */
  active?: boolean;
  /** Smaller (36 px) height; still padded to a 44 px tap area. */
  compact?: boolean;
  children: ReactNode;
}

/** primary = Highlight fill (Add, Retry); secondary = Cards fill with a grid-line border; ghost = transparent; chip = pill filter. */
export function Button({ variant = 'secondary', active, compact, className, type = 'button', children, ...rest }: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, active && 'is-active', compact && 'btn--compact', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} aria-pressed={variant === 'chip' ? !!active : undefined} {...rest}>
      {children}
    </button>
  );
}
