// The script's Back (COMPARE_HTML: startRun / rerun / back / ask): every pick is recorded, and Back reruns
// the run from the start, replaying every pick but the last one instantly, so the person lands on the
// question they want to change with everything else kept.
import type { CompareRun, Question, RunOutcome } from './runs';
import type { Answer } from './types';

export type SessionState = { kind: 'ask'; question: Question } | { kind: 'done'; outcome: RunOutcome };

export interface Session {
  readonly current: SessionState;
  /** Questions asked in this run so far, replayed ones and the one showing included (the script's `asked`). */
  readonly asked: number;
  /** Back is offered: there is a pick to undo, on a question or on the review screen. */
  readonly canBack: boolean;
  /**
   * The person pressed Stop at some point. Stays true after Back, as the script's `S.queue.length = 0` /
   * `unratedList.length = 0` do: the caller drops the rest of its queue and, when `start` is called again,
   * shows 0 waiting.
   */
  readonly stopRequested: boolean;
  answer(a: Answer): void;
  back(): void;
}

/** `start` is called again on every Back, so it may read the session (e.g. `stopRequested`). */
export function createSession(start: () => CompareRun): Session {
  let history: Answer[] = [], asked = 0, stopRequested = false;
  let run: CompareRun, current!: SessionState;

  // Runs until a question needs a live answer or the run ends, answering from `replay` meanwhile.
  const advance = (step: IteratorResult<Question, RunOutcome>, replay: Answer[]) => {
    while (!step.done) {
      asked++;
      const r = replay.shift();
      if (r === undefined) { current = { kind: 'ask', question: step.value }; return; }
      history.push(r);
      step = run.next(r);
    }
    current = { kind: 'done', outcome: step.value };
  };
  const restart = () => {
    const replay = history.slice();
    history = []; asked = 0;
    run = start();
    advance(run.next(undefined as unknown as Answer), replay); // the first next() argument is ignored
  };
  const canBack = () => history.length > 0 && (current.kind === 'ask' || current.outcome.kind === 'review');

  restart();
  return {
    get current() { return current; },
    get asked() { return asked; },
    get canBack() { return canBack(); },
    get stopRequested() { return stopRequested; },
    answer(a) {
      if (current.kind !== 'ask') return;
      if (a === 'stop') stopRequested = true;
      else history.push(a);
      advance(run.next(a), []);
    },
    back() {
      if (!canBack()) return;
      history.pop();
      restart();
    },
  };
}
