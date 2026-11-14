import { CATEGORY_CONFIG } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
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
import { CompareHome } from './compare/CompareHome';
import { PairView } from './compare/PairView';
import { ReviewView, useFocusHeading } from './compare/ReviewView';
import { useCompareFlow } from './compare/useCompareFlow';
import '../design/compare.css';

/** "Fix my ratings": the Sheet's Compare ratings dialog as a screen (route /compare). */
export function CompareScreen() {
  const me = useSessionMe();
  const wide = useIsWide();
  const flow = useCompareFlow();
  const { view } = flow;

  // Covers for the review rows (RatingChange carries none); the same queries the flow reads.
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  const { data, isError } = useAllEntries(lists);
  const qc = useQueryClient();
  // Once a run has been on screen, coming home moves focus to the home heading.
  const ranRun = useRef(false);
  if (view.kind !== 'loading' && view.kind !== 'off' && view.kind !== 'home') ranRun.current = true;
  const byId = useMemo(() => new Map(Object.values(data).flat().map((e) => [e.id, e])), [data]);
  const coverOf = useCallback((id: string) => {
    const e = byId.get(id);
    return e ? { src: e.coverUrl, square: CATEGORY_CONFIG[e.category].square } : undefined;
  }, [byId]);

  switch (view.kind) {
    case 'loading':
      return (
        <div className="screen" aria-busy="true" aria-label="Loading">
          <PageHeader title="Compare ratings" backTo="/more" />
          <div className="screen__body stack-10"><Skeleton height={64} /><Skeleton height={64} /></div>
        </div>
      );
    case 'off':
      return (
        <div className="screen">
          <PageHeader title="Comparing is off" backTo="/more"
            sub={<>Turn it on in <Link to="/settings">Settings</Link>: “Ask to compare”.</>} />
        </div>
      );
    case 'home':
      if (isError) {
        return (
          <div className="screen">
            <PageHeader title="Compare ratings" backTo="/more" />
            <div className="screen__body">
              <EmptyState icon="info" title="Couldn't load your lists" body="Check your connection and try again."
                actionLabel="Retry" onAction={() => void qc.refetchQueries({ queryKey: ['entries'] })} />
            </div>
          </div>
        );
      }
      return (
        <CompareHome afterQueue={view.afterQueue} lists={view.lists} unrated={view.unrated} onlyNew={view.onlyNew}
          window={me.settings.compareWindow} onList={flow.startList} onUnrated={flow.startUnrated}
          focusHeading={ranRun.current} />
      );
    case 'ask':
      return (
        <RunFrame wide={wide} onHome={flow.toHome} covers={[view.left.cover, view.right.cover]}>
          <PairView question={view.question} left={view.left} right={view.right} canBack={view.canBack}
            onAnswer={flow.answer} onBack={flow.back} wide={wide} />
        </RunFrame>
      );
    case 'review':
      return (
        <RunFrame wide={wide} onHome={flow.toHome}>
          <ReviewView changes={view.changes} asked={view.asked} canBack={view.canBack} hasNext={view.hasNext}
            style={me.settings.compareStyle} coverOf={coverOf}
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
    case 'nothingToCompare':
      return (
        <RunFrame wide={wide} onHome={flow.toHome}>
          <EndView title={view.title} action="Next" onAction={flow.next}
            sub={`Nothing on ${view.listName} is rated yet, so there's nothing to compare with. Give a couple of things a rating first.`} />
        </RunFrame>
      );
  }
}

/** A run's screen: the way back to the Compare home (phone: arrow; PC: link-style), blurred covers behind on PC. */
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
          ? <button type="button" className="compare__home-link" onClick={onHome} disabled={!onHome}>← Compare ratings</button>
          : <IconButton label="Back to Compare ratings" icon="back" look="plain" onClick={onHome} disabled={!onHome} />}
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
