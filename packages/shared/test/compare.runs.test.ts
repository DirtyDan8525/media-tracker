import { describe, expect, test } from 'vitest';
import {
  COMPARE_ROOM, COMPARE_STYLE, createSession, fullPass, placeOne, placeUnrated,
  type Answer, type CompareItem, type CompareOptions, type CompareRun, type RatingChange, type RunOutcome, type Session,
} from '../src/index';
import { rng } from './helpers/prng';
import { loadScriptCompare, type RunKind, type ScriptChange, type ScriptItem, type ScriptOutcome } from './helpers/scriptCompare';

const it_ = (title: string, rating: number | null, row: number): CompareItem =>
  ({ id: `${row}|${title}`, title, rating, cover: '', square: false });
const toScript = (x: CompareItem): ScriptItem =>
  ({ row: Number(x.id.split('|')[0]), title: x.title, rating: x.rating, cover: x.cover, square: x.square });
const fromScript = (c: ScriptChange): RatingChange =>
  ({ id: `${c.row}|${c.title}`, title: c.title, old: c.old === '—' ? null : c.old, isNew: c.isNew, rating: c.rating });
const outcomeFromScript = (o: ScriptOutcome): RunOutcome => (o.kind === 'review' ? { kind: 'review', changes: o.changes.map(fromScript) } : o);

const items = [it_('A', 9, 2), it_('B', 8.8, 3), it_('C', 8.5, 4), it_('D', 8.5, 5), it_('E', 6, 6)];
const opts = { style: 'Meet in the middle', room: 'Use in-between scores', window: 1 } as const;
const q = (s: Session) => (s.current.kind === 'ask' ? `${s.current.question.a.title}|${s.current.question.b.title}|${s.current.question.progress}` : 'done');

describe('session and Back', () => {
  test('Back replays every answer but the last (script transcript)', async () => {
    const s = createSession(() => fullPass(items, 'Anime', opts));
    const seen: string[] = [];
    for (const step of ['a', 'b', 'back', 'a', 'same', 'stop'] as const) {
      if (s.current.kind === 'ask') seen.push(q(s));
      if (step === 'back') s.back(); else s.answer(step);
    }
    const want = [
      'B|A|Going through 1 of 4 · 0 picks so far', 'C|A|Going through 2 of 4 · 1 picks so far',
      'D|C|Going through 3 of 4 · 2 picks so far', 'C|A|Going through 2 of 4 · 1 picks so far',
      'C|B|Going through 2 of 4 · 2 picks so far', 'D|A|Going through 3 of 4 · 3 picks so far'];
    expect(seen).toEqual(want);
    const outcome: RunOutcome = { kind: 'review', changes: [
      { id: '4|C', title: 'C', old: 8.5, isNew: false, rating: 8.8 }, { id: '2|A', title: 'A', old: 9, isNew: false, rating: 8.7 }] };
    expect(s.current).toEqual({ kind: 'done', outcome });
    // The golden transcript is the script's.
    const script = await loadScriptCompare({ ...opts, items: items.map(toScript) }).run('fullPass', ['k', 'Anime'], ['a', 'b', 'back', 'a', 'same', 'stop']);
    expect(script.questions.map((x) => `${x.a.split('|')[1]}|${x.b.split('|')[1]}|${x.progress}`)).toEqual(want);
    expect(outcomeFromScript(script.outcome)).toEqual(outcome);
  });

  test('Back from the review screen returns to the last real pick; stopRequested survives', () => {
    const s = createSession(() => fullPass(items, 'Anime', opts));
    s.answer('a');
    const second = q(s);
    s.answer('stop');
    expect(s.current.kind).toBe('done');
    expect(s.stopRequested).toBe(true);
    expect(s.canBack).toBe(true);
    s.back();
    expect(q(s)).toBe('B|A|Going through 1 of 4 · 0 picks so far'); // the question answered 'a', not the Stop
    expect(s.asked).toBe(1);
    expect(s.stopRequested).toBe(true);
    s.answer('a');
    expect(q(s)).toBe(second);
  });

  test('back() with no history does nothing', () => {
    const s = createSession(() => fullPass(items, 'Anime', opts));
    const first = s.current;
    expect(s.canBack).toBe(false);
    s.back();
    expect(s.current).toBe(first);
    expect(s.asked).toBe(1);
  });

  test('Stop is never recorded: Back after Stop on the first question has nothing to undo', () => {
    const s = createSession(() => placeOne(items, '4|C', 'Anime', 3, opts));
    s.answer('stop');
    expect(s.current.kind).toBe('done');
    expect(s.canBack).toBe(false);
  });

  test('a skipped run offers no Back (the script moves on)', () => {
    const s = createSession(() => placeUnrated(items, it_('N', null, 9), 'Anime', 1, 1, opts));
    s.answer('a');
    s.answer('skip');
    expect(s.current).toEqual({ kind: 'done', outcome: { kind: 'skipped' } });
    expect(s.canBack).toBe(false);
  });

  test('placeOne after Stop and Back shows 0 waiting when start reads stopRequested', () => {
    let s!: Session;
    s = createSession(() => placeOne(items, '4|C', 'Anime', s?.stopRequested ? 0 : 3, opts));
    expect(q(s)).toBe('C|B|New rating · 3 waiting');
    s.answer('b');
    s.answer('stop');
    s.back();
    expect(q(s)).toBe('C|B|New rating · 0 waiting');
  });
});

describe('runs', () => {
  test('placeOne with an id not on the list is skipped', () => {
    expect(createSession(() => placeOne(items, 'nope', 'Anime', 0, opts)).current).toEqual({ kind: 'done', outcome: { kind: 'skipped' } });
  });
  test('placeUnrated with nothing rated has nothing to compare', () => {
    expect(createSession(() => placeUnrated([], it_('N', null, 9), 'Anime', 1, 2, opts)).current)
      .toEqual({ kind: 'done', outcome: { kind: 'nothingToCompare' } });
  });
  test('titles and progress', () => {
    const s = createSession(() => placeUnrated(items, it_('N', null, 9), 'Anime', 2, 5, opts));
    expect(s.current.kind === 'ask' && [s.current.question.title, s.current.question.progress]).toEqual(['Rating N (Anime)', 'Unrated 2 of 5']);
  });
  test('placeScore is only handed a rated tie', () => {
    // An unrated item in the input is dropped, so it can never be asked about or tied with.
    const s = createSession(() => placeUnrated([...items, it_('Z', null, 10)], it_('N', null, 9), 'Anime', 1, 1, opts));
    const asked: string[] = [];
    while (s.current.kind === 'ask') { asked.push(s.current.question.b.title); s.answer('same'); }
    expect(asked).not.toContain('Z');
  });
});

// ---------- randomized differential test against the script ----------
type Step = Answer | 'back';
function randomCase(seed: number, kind: RunKind) {
  const r = rng(seed);
  const n = kind === 'placeUnrated' && r() < 0.05 ? 0 : 2 + Math.floor(r() * 24); // 0 (nothing to compare) or 2–25
  const hundredths = r() < 0.25;
  const rand = () => (hundredths ? Math.round(100 + r() * 900) / 100 : Math.round(10 + r() * 90) / 10);
  const raw: CompareItem[] = [];
  for (let i = 0; i < n; i++) {
    const rating = i > 0 && r() < 0.2 ? raw[i - 1].rating : rand();
    raw.push(it_(`T${i}${r() < 0.1 ? ' ~x|y' : ''}`, rating, i + 2));
  }
  // Best first, as getRatedItems sorts: rating desc, then row.
  const list = raw.sort((a, b) => b.rating! - a.rating! || Number(a.id.split('|')[0]) - Number(b.id.split('|')[0]));
  const o: CompareOptions = {
    style: COMPARE_STYLE[Math.floor(r() * COMPARE_STYLE.length)],
    room: COMPARE_ROOM[Math.floor(r() * COMPARE_ROOM.length)],
    window: [0.3, 0.5, 1, 2, 10][Math.floor(r() * 5)],
  };
  const weights: [Step, number][] = [['a', 35], ['b', 35], ['same', 10], ['skip', 8], ['back', 8], ['stop', 4]];
  const answers: Step[] = [];
  for (let i = 0; i < 200; i++) {
    let x = r() * 100;
    for (const [s, w] of weights) { if ((x -= w) < 0) { answers.push(s); break; } }
  }
  const target = list.length && r() < 0.95 ? list[Math.floor(r() * list.length)] : it_('Missing', 5, 999);
  const waiting = Math.floor(r() * 5), nth = 1 + Math.floor(r() * 3), total = nth + Math.floor(r() * 3);
  const unrated = it_('New one', null, 1000);
  return { list, o, answers, target, waiting, nth, total, unrated };
}

// Drives a session with the same rules as the script helper: past the stream every answer is 'stop';
// at the review screen a 'back' presses "Back to last pick" when offered, anything else ends the run.
function drive(s: Session, answers: Step[]) {
  let k = 0;
  const questions: { a: string; b: string; title: string; progress: string }[] = [];
  let lastQ: unknown = null, backsFromReview = 0;
  for (;;) {
    if (s.current.kind === 'ask') {
      if (s.current.question !== lastQ) {
        lastQ = s.current.question;
        const { a, b, title, progress } = s.current.question;
        questions.push({ a: a.id, b: b.id, title, progress });
      }
      const x = k < answers.length ? answers[k++] : 'stop';
      if (x === 'back') { if (s.canBack) { lastQ = null; s.back(); } } else s.answer(x);
    } else {
      const x = k < answers.length ? answers[k] : 'stop';
      if (x === 'back' && s.canBack) { k++; backsFromReview++; lastQ = null; s.back(); } else return { questions, outcome: s.current.outcome, backsFromReview };
    }
  }
}

describe('matches the script on 300 random sessions', () => {
  test.each(['fullPass', 'placeOne', 'placeUnrated'] as const)('%s', async (kind) => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const c = randomCase(seed * 7 + kind.length, kind);
      let s!: Session;
      const start = (): CompareRun => kind === 'fullPass' ? fullPass(c.list, 'Anime', c.o)
        : kind === 'placeOne' ? placeOne(c.list, c.target.id, 'Anime', s?.stopRequested ? 0 : c.waiting, c.o)
          : placeUnrated(c.list, c.unrated, 'Anime', c.nth, c.total, c.o);
      s = createSession(start);
      const port = drive(s, c.answers);
      const script = await loadScriptCompare({ ...c.o, queueLength: c.waiting, items: c.list.map(toScript) }).run(kind,
        kind === 'fullPass' ? ['k', 'Anime'] : kind === 'placeOne' ? [{ key: 'k', title: c.target.title, tabName: 'Anime' }]
          : [{ ...toScript(c.unrated), key: 'k', tabName: 'Anime' }, c.nth, c.total], c.answers);
      seen.add(port.outcome.kind);
      if (port.backsFromReview) seen.add('back from review');
      expect({ seed, questions: port.questions, outcome: port.outcome }).toEqual({ seed, questions: script.questions, outcome: outcomeFromScript(script.outcome) });
    }
    // The streams reach every ending and Back from the review screen.
    expect([...seen].sort()).toEqual((kind === 'fullPass' ? ['back from review', 'review']
      : kind === 'placeOne' ? ['back from review', 'review', 'skipped'] : ['back from review', 'nothingToCompare', 'review', 'skipped']).sort());
  }, 60_000);
});
