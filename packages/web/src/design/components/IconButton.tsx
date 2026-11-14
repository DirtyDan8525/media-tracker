import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The accessible name (also the tooltip). */
  label: string;
  icon: IconName;
  /** 'outlined' = the mockups' 44 px Cards square with a border; 'plain' = no fill. */
  look?: 'outlined' | 'plain';
}

export function IconButton({ label, icon, look = 'outlined', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={['icon-btn', `icon-btn--${look}`, className].filter(Boolean).join(' ')} {...rest}>
      <Icon name={icon} size={22} />
    </button>
  );
}
