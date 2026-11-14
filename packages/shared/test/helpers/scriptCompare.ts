// Test oracle: loads the real COMPARE_HTML <script> out of reference/MediaTrackerCovers.gs into a node:vm
// context, so the port can be checked against the script itself.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export interface ScriptItem { row: number; title: string; rating: number | null; cover: string; square: boolean; isNew?: boolean }
export interface ScriptChange { row: number; title: string; old: number | '—'; isNew: boolean; rating: number }
export interface ScriptCompare {
  ctx: vm.Context;
  rescore(order: ScriptItem[], better: Set<string>, ties: Set<string>): ScriptChange[];
  placeScore(order: ScriptItem[], idx: number, tie: ScriptItem | null): ScriptChange[] | null;
  /**
   * Start one of the script's runs with its own `startRun` (so its own Back works) and feed it answers.
   * `args` are the script's arguments without `next`: fullPass `[key, name]`, placeOne `[q]`,
   * placeUnrated `[u, nth, total]`. Every list loads as `setup.items`. A 'back' at the review screen
   * presses "Back to last pick" when the script shows it; any other answer there (or running out of
   * answers) ends the run. Answers past the end of the stream are 'stop'.
   */
  run(kind: RunKind, args: unknown[], answers: (ScriptAnswer | 'back')[]): Promise<ScriptRun>;
}
export type RunKind = 'fullPass' | 'placeOne' | 'placeUnrated';
export type ScriptAnswer = 'a' | 'b' | 'same' | 'skip' | 'stop';
export type ScriptOutcome = { kind: 'review'; changes: ScriptChange[] } | { kind: 'skipped' } | { kind: 'nothingToCompare' };
export interface ScriptQuestion { a: string; b: string; title: string; progress: string }
export interface ScriptRun { questions: ScriptQuestion[]; outcome: ScriptOutcome }

let scriptJs: string | undefined;
function compareJs(): string {
  if (scriptJs !== undefined) return scriptJs;
  const src = readFileSync(new URL('../../../../reference/MediaTrackerCovers.gs', import.meta.url), 'utf8');
  const start = 'const COMPARE_HTML = `';
  const end = '</script></body></html>';
  const a = src.indexOf(start) + start.length;
  const b = src.indexOf(end + '`;', a) + end.length;
  // The template literal has no ${…}; evaluating it turns its escapes (\\' etc.) into what the browser gets.
  const html = new Function('return `' + src.slice(a, b) + '`')() as string;
  scriptJs = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  return scriptJs;
}

/** Script ids are `row|title`. */
export const scriptId = (x: { row: number; title: string }) => x.row + '|' + x.title;
export const scriptPk = (a: { row: number; title: string }, b: { row: number; title: string }) =>
  [scriptId(a), scriptId(b)].sort().join('~');

export function loadScriptCompare(setup: { style: string; room: string; window: number; ask?: string; queueLength?: number; items?: ScriptItem[] }): ScriptCompare {
  const v = { innerHTML: '' };
  const ctx = vm.createContext({
    document: { getElementById: (id: string) => (id === 'v' ? v : { onclick: null }), addEventListener() {} },
    google: { script: { host: { close() {} } } },
  });
  const S = { ask: setup.ask ?? 'Both', queue: [], tabs: [], unrated: [],
              style: setup.style, room: setup.room, window: setup.window };
  vm.runInContext(compareJs().replace('__SETUP__', JSON.stringify(S)), ctx);
  vm.runInContext('Math.random = () => 0.99', ctx); // never flip: 'L' is always the first argument ('a')
  // Filled after loading: a non-empty queue at load makes the script start placing it straight away.
  vm.runInContext(`S.queue = Array(${setup.queueLength ?? 0}).fill({})`, ctx);
  return {
    ctx,
    rescore: (order, better, ties) => ctx.rescore(order, better, ties),
    placeScore: (order, idx, tie) => ctx.placeScore(order, idx, tie),
    run: (kind, args, answers) => new Promise<ScriptRun>((resolve, reject) => {
      const questions: ScriptQuestion[] = [];
      let k = 0, finished = false;
      const nextAnswer = () => (k < answers.length ? answers[k++] : 'stop');
      const peek = () => (k < answers.length ? answers[k] : 'stop');
      const historyLength = () => vm.runInContext('history.length', ctx) as number;
      const finish = (outcome: ScriptOutcome) => { if (!finished) { finished = true; resolve({ questions, outcome }); } };
      const pick = (s: string) => vm.runInContext(`pickSide(${JSON.stringify(s)})`, ctx);
      const feed = () => {
        if (finished) return;
        const a = nextAnswer();
        if (a === 'back') {
          const could = historyLength() > 0;
          pick('back');
          if (!could) setTimeout(feed, 0); // the button is disabled: still on the same question
          return;
        }
        pick(a === 'a' ? 'L' : a === 'b' ? 'R' : a); // Math.random is 0.99, so L is the first argument
      };
      const scriptAsk = ctx.ask as (a: ScriptItem, b: ScriptItem, title: string, progress: string) => Promise<string>;
      ctx.ask = (a: ScriptItem, b: ScriptItem, title: string, progress: string) => {
        const p = scriptAsk(a, b, title, progress);
        if (vm.runInContext('answer !== null', ctx)) { // a replayed question resolves without setting `answer`
          questions.push({ a: scriptId(a), b: scriptId(b), title, progress });
          setTimeout(feed, 0);
        }
        return p;
      };
      ctx.loadItems = async () => setup.items ?? [];
      ctx.review = (_key: string, changes: ScriptChange[]) => {
        setTimeout(() => {
          // The review screen shows "← Back to last pick" only when there is a pick to go back to.
          if (peek() === 'back' && historyLength() > 0) { k++; vm.runInContext('back()', ctx); }
          else finish({ kind: 'review', changes });
        }, 0);
      };
      const next = () => finish({ kind: 'skipped' });
      ctx.__args = kind === 'fullPass' ? args : kind === 'placeOne' ? [args[0], next] : [args[0], next, args[1], args[2]];
      try { vm.runInContext(`startRun(${kind}, __args)`, ctx); } catch (e) { reject(e); return; }
      setTimeout(() => { if (v.innerHTML.includes('nothing to compare')) finish({ kind: 'nothingToCompare' }); }, 0);
    }),
  };
}
