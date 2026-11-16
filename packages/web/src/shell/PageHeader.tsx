import type { ReactNode, Ref } from 'react';
import { CoverBackdrop } from '../design/components/CoverBackdrop';
import { Icon, type IconName } from '../design/components/Icon';
import { BackButton } from './BackButton';
import { ProfileButton } from './ProfileButton';

export interface PageHeaderProps {
  title: string;
  sub?: ReactNode;
  /** Phone-only back button target (PC has the side nav). */
  backTo?: string;
  /** Back returns to the previous in-app screen when there is one; `backTo` is the fallback. */
  backUsesHistory?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
  /** A cover to blur behind the header (the Profile banner). */
  backdrop?: string | null;
  /** Given: the title can take focus from script (tabIndex -1), e.g. to announce a screen change. */
  titleRef?: Ref<HTMLHeadingElement>;
  /** Extra class on the header (a screen's own banner styling). */
  className?: string;
  /**
   * B22 themed bar (list screens): the header is a Header row band holding this icon, the title, the
   * actions and (phone) the profile button; the sub-line and children follow it on Background.
   */
  icon?: IconName;
  /** B9: the profile button at the top right (phone only; main screens). */
  profile?: boolean;
}

/** Screen title block: 26 px bold title (28 px on PC), muted sub-line, optional actions on the right. */
export function PageHeader({ title, sub, backTo, backUsesHistory, actions, children, backdrop, titleRef, className, icon, profile }: PageHeaderProps) {
  const h1 = <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="page-title">{title}</h1>;
  const end = (actions || profile) && (
    <div className="page-header__actions">{actions}{profile && <ProfileButton />}</div>
  );
  if (icon) {
    // The band is the header itself; the sub-line and chips follow it on Background.
    return (
      <>
        <header className={['page-header', 'page-header--bar', className].filter(Boolean).join(' ')}>
          <div className="page-header__titles page-header__titles--bar">
            <span className="page-header__icon"><Icon name={icon} size={26} /></span>
            {h1}
          </div>
          {end}
        </header>
        {(sub || children) && (
          <div className="page-header__below">
            {sub && <span className="page-sub">{sub}</span>}
            {children}
          </div>
        )}
      </>
    );
  }
  return (
    <header className={['page-header', backdrop && 'has-backdrop', className].filter(Boolean).join(' ')}>
      <CoverBackdrop src={backdrop} />
      {backTo && <BackButton to={backTo} useHistory={backUsesHistory} />}
      <div className="page-header__row">
        <div className="page-header__titles">
          {h1}
          {sub && <span className="page-sub">{sub}</span>}
        </div>
        {end}
      </div>
      {children}
    </header>
  );
}
