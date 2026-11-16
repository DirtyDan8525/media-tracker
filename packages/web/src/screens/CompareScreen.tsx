import type { Category } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAllEntries } from '../data/useEntries';
import { Button } from '../design/components/Button';
import { CoverBackdrop } from '../design/components/CoverBackdrop';
import { EmptyState } from '../design/components/EmptyState';
import { IconButton } from '../design/components/IconButton';
import { Skeleton } from '../design/components/Skeleton';
import { useIsWide } from '../hooks';
import { enabledLists } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { CompareHome, HOME_TITLE } from './compare/CompareHome';
import { PairView } from './compare/PairView';
import { ReviewView, useFocusHeading } from './compare/ReviewView';
import { TierQuestion } from './compare/TierQuestion';
import { useRatingFlow } from './compare/useRatingFlow';
import '../design/compare.css';

/** "Fix my ratings" on the tier model (route /compare; `?place=<id>` places one title, then returns to its list). */
export function CompareScreen() {
  const me = useSessionMe();
  const wide = useIsWide();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const place = params.get('place') ?? undefined;
  const onPlaced = useCallback((c: Category) => navigate(`/list/${c}`), [navigate]);
  const flow = useRatingFlow(place ? { place, onPlaced } : {});
  const { view } = flow;

  const { isError } = useAllEntries(enabledLists(me.settings));
  const qc = useQueryClient();
  // Once a run has been on screen, coming home moves focus to the home heading.
  const ranRun = useRef(false);
  if (view.kind !== 'loading' && view.kind !== 'off' && view.kind !== 'home') ranRun.current = true;

  switch (view.kind) {
    case 'loading':
      return (
        <div className="screen" aria-busy="true" aria-label="Loading">
          <PageHeader title={HOME_TITLE} profile />
          <div className="screen__body stack-10"><Skeleton height={64} /><Skeleton height={64} /></div>
        </div>
      );
    case 'off':
      return (
        <div className="screen">
          <PageHeader title="Comparing is off" profile
            sub={<>Turn it on in <Link to="/settings/appearance">Settings</Link>: “Ask to compare”.</>} />
        </div>
      );
    case 'home':
      if (isError) {
        return (
          <div className="screen">
            <PageHeader title={HOME_TITLE} profile />
            <div className="screen__body">
              <EmptyState icon="info" title="Couldn't load your lists" body="Check your connection and try again."
                actionLabel="Retry" onAction={() => void qc.refetchQueries({ queryKey: ['entries'] })} />
            </div>
          </div>
        );
      }
      return (
        <CompareHome afterQueue={view.afterQueue} lists={view.lists} unrated={view.unrated} onlyNew={view.onlyNew}
          chosen={view.chosen} tiers={view.tiers} onList={flow.chooseList} onTier={flow.chooseTier} onRetryTiers={flow.retryTiers}
          onUnrated={flow.startUnrated} focusHeading={ranRun.current} />
      );
    case 'ask':
      return (
        <RunFrame wide={wide} onHome={flow.toHome} covers={[view.left.cover, view.right.cover]}>
          <PairView heading={view.heading} sub={view.sub} aId={view.aId} left={view.left} right={view.right}
            progress={view.progress} canBack={view.canBack} settled={view.settled} tierNames={view.tierNames}
            tierRanges={view.tierRanges} onAnswer={flow.answer} onBack={flow.back} onMove={flow.move} wide={wide} />
        </RunFrame>
      );
    case 'tier':
      return (
        <RunFrame wide={wide} onHome={flow.toHome}>
          <TierQuestion item={view.item} context={view.context} names={view.tierNames} ranges={view.ranges} canBack={view.canBack}
            onPick={flow.pickTier} onBack={flow.back} onSkip={() => flow.answer('skip')} onStop={() => flow.answer('stop')} />
        </RunFrame>
      );
    case 'review':
      return (
        <RunFrame wide={wide} onHome={flow.toHome}>
          <ReviewView changes={view.changes} canBack={view.canBack} hasNext={view.hasNext} hasPicks={view.hasPicks}
            tierNames={view.tierNames} coverOf={flow.coverOf} conflict={view.conflict} onReload={flow.reload}
            onBack={flow.back} onSave={() => void flow.save()} onDontSave={flow.dontSave} onNext={flow.next} />
        </RunFrame>
      );
    case 'saving':
      return (
        <RunFrame wide={wide}>
          <div className="compare__head" aria-busy="true"><span className="compare__sub" role="status">Saving…</span></div>
        </RunFrame>
      );
    case 'saved':
      return (
        <RunFrame wide={wide} onHome={flow.toHome}>
          <EndView title="Saved" sub="Top 5 and Stats update by themselves." action="Close" onAction={flow.next} />
        </RunFrame>
      );
    case 'nothingLeft':
      return (
        <RunFrame wide={wide} onHome={flow.toHome}>
          <EndView title="All settled" sub={view.line} action="Close" onAction={flow.next} />
        </RunFrame>
      );
  }
}

/** A run's screen: the way back to the home (phone: arrow; PC: link-style), blurred covers behind on PC. */
/** Without `onHome` (while saving) the way home is shown but off, so a save can't land on a run that was left. */
function RunFrame({ wide, onHome, covers, children }: { wide: boolean; onHome?: () => void; covers?: string[]; children: ReactNode }) {
  return (
    <div className={wide ? 'screen compare compare--wide has-backdrop' : 'screen compare'}>
      {wide && covers && (
        <div className="compare__backdrops" aria-hidden="true">
          {covers.map((src, i) => <CoverBackdrop key={`${i}-${src}`} src={src} className={i ? 'backdrop--r' : 'backdrop--l'} />)}
        </div>
      )}
      <div className="compare__top">
        {wide
          ? <button type="button" className="compare__home-link" onClick={onHome} disabled={!onHome}>← {HOME_TITLE}</button>
          : <IconButton label={`Back to ${HOME_TITLE}`} icon="back" look="plain" onClick={onHome} disabled={!onHome} />}
      </div>
      <div className="compare__body">{children}</div>
    </div>
  );
}

function EndView({ title, sub, action, onAction }: { title: string; sub: string; action: string; onAction(): void }) {
  const heading = useFocusHeading<HTMLHeadingElement>();
  return (
    <div className="compare-review">
      <div className="compare__head">
        <h1 ref={heading} tabIndex={-1} className="compare__title">{title}</h1>
        <span className="compare__sub">{sub}</span>
      </div>
      <div className="compare__end-actions">
        <Button variant="primary" className="btn--block" onClick={onAction}>{action}</Button>
      </div>
    </div>
  );
}
