import { expect, test } from 'vitest';
import { fitTier, nextPair, sigmoid, type Comparison, type RatedItem } from '../src/ratings';
import { rng } from './helpers/prng';

// Spec §8: simulated people with hidden true strengths type noisy scores, then answer picks with
// some noise. Agreement between the fitted order and the true order must rise with picks, and
// nextPair's questions must beat random pairs. THRESHOLD is held fixed (see below).

const PEOPLE = 50;
const TITLES = 30;
const CHECKPOINTS = [0, 10, 30, 60];

function normal(R: () => number): number {
  const u = 1 - R(), v = R();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function kendallTau(a: number[], b: number[]): number {
  let c = 0, d = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const s = Math.sign(a[i] - a[j]) * Math.sign(b[i] - b[j]);
      if (s > 0) c++; else if (s < 0) d++;
    }
  }
  return (c - d) / ((a.length * (a.length - 1)) / 2);
}

function simulate(seed = 1000, randomSeed = 5000): { smart: number[]; random: number[] } {
  const smart = CHECKPOINTS.map(() => 0), random = CHECKPOINTS.map(() => 0);
  for (let p = 0; p < PEOPLE; p++) {
    const R = rng(seed + p);
    const truth = Array.from({ length: TITLES }, () => 1.2 * normal(R));
    const items: RatedItem[] = truth.map((t, i) => {
      const prior = t + 0.8 * normal(R);
      return { id: `t${String(i).padStart(2, '0')}`, title: `t${i}`, rating: 9.5, tier: 3, priorMean: prior, strength: prior, scoreLocked: false };
    });
    const truthOf = new Map(items.map((it, i) => [it.id, truth[i]]));

    const answer = (rand: () => number, a: string, b: string, k: number): Comparison => {
      const ta = truthOf.get(a)!, tb = truthOf.get(b)!;
      const base = { id: `c${k}`, createdAt: '', undoneAt: null };
      if (Math.abs(ta - tb) < 0.1 && rand() < 0.3) return { ...base, winnerId: a, loserId: b, isTie: true };
      const [better, worse] = ta >= tb ? [a, b] : [b, a];
      return rand() < sigmoid(2.5 * Math.abs(ta - tb))
        ? { ...base, winnerId: better, loserId: worse, isTie: false }
        : { ...base, winnerId: worse, loserId: better, isTie: false };
    };
    const tau = (comps: Comparison[]) => {
      const s = fitTier(items, comps);
      return kendallTau(items.map((i) => s.get(i.id)!), truth);
    };

    const run = (choose: (comps: Comparison[]) => [string, string] | null, rand: () => number, into: number[]) => {
      const comps: Comparison[] = [];
      for (let k = 0; k <= 60; k++) {
        const at = CHECKPOINTS.indexOf(k);
        if (at >= 0) into[at] += tau(comps) / PEOPLE;
        if (k === 60) break;
        const pair = choose(comps);
        if (pair === null) break;
        comps.push(answer(rand, pair[0], pair[1], k));
      }
    };

    run((comps) => nextPair(items, comps, fitTier(items, comps), new Set()), R, smart);
    const R2 = rng(randomSeed + p);
    run(() => {
      const a = Math.floor(R2() * TITLES); let b = Math.floor(R2() * (TITLES - 1)); if (b >= a) b++;
      return [items[a].id, items[b].id];
    }, R2, random);
  }
  return { smart, random };
}

// First run (2026-11-15): smart = [0.6120, 0.6544, 0.7152, 0.7798], random = [0.6120, 0.6376, 0.6771, 0.7239].
// smart[3] − random[3] by seed pair (people seed, random-pair seed), PRINT_SIM_SEEDS=1 to reprint:
//   1000/5000 0.0559 · 2000/6000 0.0550 · 3000/7000 0.0606 · 4000/8000 0.0492 · 5000/9000 0.0634 · 6000/10000 0.0626
// (standard error ≈ 0.007 each). The threshold is 0.03, below every seed, so a harmless change in
// how the random numbers are drawn can't flip it, while a real regression (no gain over random
// pairs) still fails. Ruling 2026-11-15 (fix round 1). Print the main run with PRINT_SIM=1.
const THRESHOLD = 0.03;

test('simulation: order agreement rises with picks, and nextPair beats random pairs', () => {
  const { smart, random } = simulate();
  if (process.env.PRINT_SIM) console.log(JSON.stringify({ smart, random, diff: smart[3] - random[3] }));
  expect(smart[1]).toBeGreaterThan(smart[0]); expect(smart[2]).toBeGreaterThan(smart[1]); expect(smart[3]).toBeGreaterThan(smart[2]);
  expect(smart[3] - random[3]).toBeGreaterThanOrEqual(THRESHOLD); // held fixed
});

test.skipIf(!process.env.PRINT_SIM_SEEDS)('print the gap for other seeds', () => {
  for (let k = 0; k < 6; k++) {
    const { smart, random } = simulate(1000 * (k + 1), 1000 * (k + 5));
    console.log('SEED', 1000 * (k + 1), 1000 * (k + 5), (smart[3] - random[3]).toFixed(4));
  }
});
