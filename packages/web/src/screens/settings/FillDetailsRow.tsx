import { useId } from 'react';
import { useBackfill } from '../../backfill/useBackfill';
import { Button } from '../../design/components/Button';
import { ProgressBar } from '../../design/components/ProgressBar';

export const needsPickText = (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} you to pick the right match`;

/** Settings → Your data → "Fill in details": Start / Pause, a progress bar and what is left. */
export function FillDetailsRow() {
  const { running, done, total, needsReview, pending, start, stop } = useBackfill();
  const labelId = useId();
  const inRun = total > 0 && (running || done < total);
  const review = needsReview > 0 ? needsPickText(needsReview) : '';

  let status: string;
  if (inRun) status = [`${done} of ${total}`, review].filter(Boolean).join(' · ');
  else if (pending === null) status = 'Checking your titles…';
  else if (pending > 0) status = [`${pending} ${pending === 1 ? 'title' : 'titles'} still need details`, review].filter(Boolean).join(' · ');
  else status = ['All details filled in', review].filter(Boolean).join(' · ');

  return (
    <div role="group" aria-labelledby={labelId} className="fill-row">
      <div className="fill-row__top">
        <span id={labelId}>Fill in details</span>
        {running
          ? <Button variant="ghost" compact onClick={stop}>Pause</Button>
          : <Button variant="ghost" compact onClick={start} disabled={pending === 0 && !inRun}>Start</Button>}
      </div>
      {inRun && <ProgressBar label="Fill in details progress" value={done} max={total} />}
      <span className="fill-row__status">{status}</span>
    </div>
  );
}
