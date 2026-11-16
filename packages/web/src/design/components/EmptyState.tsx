import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /** Given (with `actionLabel`): the action is a primary-styled link to this path instead of a button. */
  actionHref?: string;
}

export function EmptyState({ title, body, icon = 'plus', actionLabel, onAction, actionHref }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon"><Icon name={icon} size={28} /></div>
      <h2 className="empty-state__title">{title}</h2>
      {body && <p className="empty-state__body">{body}</p>}
      {actionLabel && actionHref && <Link className="btn btn--primary" to={actionHref}>{actionLabel}</Link>}
      {actionLabel && !actionHref && onAction && <Button variant="primary" onClick={onAction}>{actionLabel}</Button>}
    </div>
  );
}
