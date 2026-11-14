import type { ReactNode, Ref } from 'react';
import { CoverBackdrop } from '../design/components/CoverBackdrop';
import { BackButton } from './BackButton';

export interface PageHeaderProps {
  title: string;
  sub?: ReactNode;
  /** Phone-only back button target (PC has the side nav). */
  backTo?: string;
  /** Back returns to the previous in-app screen when there is one; `backTo` is the fallback. */
  backUsesHistory?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
  /** A cover to blur behind the header (v2 list header: the list's highest-rated title). */
  backdrop?: string | null;
  /** Given: the title can take focus from script (tabIndex -1), e.g. to announce a screen change. */
  titleRef?: Ref<HTMLHeadingElement>;
}

/** Screen title block: 26 px bold title (28 px on PC), muted sub-line, optional actions on the right. */
export function PageHeader({ title, sub, backTo, backUsesHistory, actions, children, backdrop, titleRef }: PageHeaderProps) {
  return (
    <header className={backdrop ? 'page-header has-backdrop' : 'page-header'}>
      <CoverBackdrop src={backdrop} />
      {backTo && <BackButton to={backTo} useHistory={backUsesHistory} />}
      <div className="page-header__row">
        <div className="page-header__titles">
          <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="page-title">{title}</h1>
          {sub && <span className="page-sub">{sub}</span>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
