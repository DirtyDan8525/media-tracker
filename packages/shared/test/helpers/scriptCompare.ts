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
  /** Task 2: start a run (`kind` is the script's function name) and feed it answers. */
  run(kind: string, args: unknown[], answers: string[]): unknown;
}

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

export function loadScriptCompare(setup: { style: string; room: string; window: number; ask?: string; queueLength?: number }): ScriptCompare {
  const v = { innerHTML: '' };
  const ctx = vm.createContext({
    document: { getElementById: (id: string) => (id === 'v' ? v : { onclick: null }), addEventListener() {} },
    google: { script: { host: { close() {} } } },
  });
  const S = { ask: setup.ask ?? 'Both', queue: Array(setup.queueLength ?? 0).fill({}), tabs: [], unrated: [],
              style: setup.style, room: setup.room, window: setup.window };
  vm.runInContext(compareJs().replace('__SETUP__', JSON.stringify(S)), ctx);
  vm.runInContext('Math.random = () => 0.99', ctx); // never flip: 'L' is always the first argument ('a')
  return {
    ctx,
    rescore: (order, better, ties) => ctx.rescore(order, better, ties),
    placeScore: (order, idx, tie) => ctx.placeScore(order, idx, tie),
    run: (kind, args, answers) => {
      throw new Error(`run(${kind}, ${args.length} args, ${answers.length} answers) is added in Task 2`);
    },
  };
}
