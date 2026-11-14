import type { ReactNode } from 'react';
import { CoverBackdrop } from '../design/components/CoverBackdrop';
import { BackButton } from './BackButton';

export interface PageHeaderProps {
  title: string;
  sub?: ReactNode;
  /** Phone-only back button target (PC has the side nav). */
  backTo?: string;
  actions?: ReactNode;
  children?: ReactNode;
  /** A cover to blur behind the header (v2 list header: the list's highest-rated title). */
  backdrop?: string | null;
}

/** Screen title block: 26 px bold title (28 px on PC), muted sub-line, optional actions on the right. */
export function PageHeader({ title, sub, backTo, actions, children, backdrop }: PageHeaderProps) {
  return (
    <header className={backdrop ? 'page-header has-backdrop' : 'page-header'}>
      <CoverBackdrop src={backdrop} />
      {backTo && <BackButton to={backTo} />}
      <div className="page-header__row">
        <div className="page-header__titles">
          <h1 className="page-title">{title}</h1>
          {sub && <span className="page-sub">{sub}</span>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
