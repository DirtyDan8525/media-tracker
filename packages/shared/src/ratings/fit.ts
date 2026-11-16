import { PRIOR_SD, sigmoid } from './score';
import type { Comparison, RatedItem } from './types';

type FitItem = Pick<RatedItem, 'id' | 'priorMean' | 'scoreLocked'>;
type FitComparison = Pick<Comparison, 'winnerId' | 'loserId' | 'isTie' | 'undoneAt'>;

const MAX_STEPS = 100;

/**
 * Work counters for a fit, added up across calls (pass the same object to several fits). They are
 * deterministic, so tests can guard the fit's cost without timing it: `fits` calls, `groups`
 * Newton solves (one per group of free titles linked by picks), `steps` Newton steps in total,
 * `maxGroup` the largest group (the dense solve is O(maxGroup³) per step), `picks` counted picks.
 */
export interface FitStats { fits: number; groups: number; steps: number; maxGroup: number; picks: number }
export const newFitStats = (): FitStats => ({ fits: 0, groups: 0, steps: 0, maxGroup: 0, picks: 0 });
const TOLERANCE = 1e-12;

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The picks that count in a fit over `ids`: not undone, both titles known, two different titles.
 * Sorted by (winnerId, loserId, isTie) so the fit sums them in a fixed order (Ruling Q12).
 */
export function countedPicks<C extends FitComparison>(ids: ReadonlySet<string>, comparisons: readonly C[]): C[] {
  return comparisons
    .filter((c) => c.undoneAt === null && c.winnerId !== c.loserId && ids.has(c.winnerId) && ids.has(c.loserId))
    .sort((a, b) => cmpStr(a.winnerId, b.winnerId) || cmpStr(a.loserId, b.loserId) || Number(a.isTie) - Number(b.isTie));
}

/**
 * Bradley-Terry fit of one tier with a Gaussian prior around each title's starting point (MAP,
 * spec §5.2). Returns a strength for every item. Titles with no counted pick, and locked titles,
 * keep exactly their prior; locked titles still pull the others. A null prior counts as 0 (the
 * middle). The objective is strictly concave, so Newton steps from the priors reach its one
 * optimum; titles and picks are sorted first, so any input order gives bit-identical strengths.
 *
 * The free titles split into groups linked by picks (connected components of the pick graph, with
 * locked titles as fixed opponents that don't link groups). The objective is a sum over the
 * groups, so fitting each group on its own gives the same optimum and costs far less than one
 * dense solve over the whole tier (Newton's dense Cholesky solve is O(k³) per step).
 */
export function fitTier(items: FitItem[], comparisons: FitComparison[], opts?: { priorSd?: number; stats?: FitStats }): Map<string, number> {
  const sd = opts?.priorSd ?? PRIOR_SD;
  const invVar = 1 / (sd * sd);
  const sorted = [...items].sort((a, b) => cmpStr(a.id, b.id));
  const ids = new Set(sorted.map((i) => i.id));
  const picks = countedPicks(ids, comparisons);
  const stats = opts?.stats;
  if (stats) { stats.fits++; stats.picks += picks.length; }

  const s = new Map<string, number>();
  for (const it of sorted) s.set(it.id, it.priorMean ?? 0);

  const inPick = new Set<string>();
  for (const p of picks) { inPick.add(p.winnerId); inPick.add(p.loserId); }
  const free = sorted.filter((it) => inPick.has(it.id) && !it.scoreLocked);
  if (free.length === 0) return s;

  // Union-find over the free titles; a pick links two free titles.
  const pos = new Map<string, number>(free.map((it, i) => [it.id, i]));
  const parent = free.map((_, i) => i);
  const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const p of picks) {
    const w = pos.get(p.winnerId), l = pos.get(p.loserId);
    if (w !== undefined && l !== undefined) { const a = root(w), b = root(l); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
  }
  // Groups in order of their first (smallest) id; titles and picks keep their sorted order.
  const groups = new Map<number, { free: FitItem[]; picks: FitComparison[] }>();
  free.forEach((it, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, { free: [], picks: [] });
    groups.get(r)!.free.push(it);
  });
  for (const p of picks) {
    const i = pos.get(p.winnerId) ?? pos.get(p.loserId);
    if (i !== undefined) groups.get(root(i))!.picks.push(p);
  }
  for (const g of groups.values()) {
    const steps = newton(g.free, g.picks, s, invVar);
    if (stats) { stats.groups++; stats.steps += steps; stats.maxGroup = Math.max(stats.maxGroup, g.free.length); }
  }
  return s;
}

/** Newton steps for one group of free titles; writes their strengths into `s`. Returns the steps taken. */
function newton(free: FitItem[], picks: FitComparison[], s: Map<string, number>, invVar: number): number {
  const k = free.length, n = picks.length;
  const idx = new Map<string, number>(free.map((it, i) => [it.id, i]));
  const mu = Float64Array.from(free, (it) => it.priorMean ?? 0);
  const x = Float64Array.from(mu);
  // Per pick: the free index of each side (−1 = a fixed opponent, with its strength), and y.
  const W = new Int32Array(n), L = new Int32Array(n), FW = new Float64Array(n), FL = new Float64Array(n), Y = new Float64Array(n);
  picks.forEach((p, j) => {
    W[j] = idx.get(p.winnerId) ?? -1; L[j] = idx.get(p.loserId) ?? -1;
    FW[j] = W[j] < 0 ? s.get(p.winnerId)! : 0; FL[j] = L[j] < 0 ? s.get(p.loserId)! : 0;
    Y[j] = p.isTie ? 0.5 : 1;
  });

  const g = new Float64Array(k);
  const H = new Float64Array(k * k);
  let taken = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    taken++;
    H.fill(0);
    for (let i = 0; i < k; i++) { g[i] = -(x[i] - mu[i]) * invVar; H[i * k + i] = invVar; }
    for (let j = 0; j < n; j++) {
      const w = W[j], l = L[j];
      const pr = sigmoid((w >= 0 ? x[w] : FW[j]) - (l >= 0 ? x[l] : FL[j]));
      const r = Y[j] - pr;
      const h = pr * (1 - pr);
      if (w >= 0) { g[w] += r; H[w * k + w] += h; }
      if (l >= 0) { g[l] -= r; H[l * k + l] += h; }
      if (w >= 0 && l >= 0) { H[w * k + l] -= h; H[l * k + w] -= h; }
    }
    const d = choleskySolve(H, g, k);
    let max = 0;
    for (let i = 0; i < k; i++) { x[i] += d[i]; max = Math.max(max, Math.abs(d[i])); }
    if (max < TOLERANCE) break;
  }
  for (let i = 0; i < k; i++) s.set(free[i].id, x[i]);
  return taken;
}

/** Σ A[a+m]·A[b+m] for m < n, four sums at a time (a fixed order, so results are reproducible). */
function dot(A: Float64Array, a: number, b: number, n: number): number {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, m = 0;
  for (; m + 3 < n; m += 4) {
    s0 += A[a + m] * A[b + m]; s1 += A[a + m + 1] * A[b + m + 1];
    s2 += A[a + m + 2] * A[b + m + 2]; s3 += A[a + m + 3] * A[b + m + 3];
  }
  for (; m < n; m++) s0 += A[a + m] * A[b + m];
  return (s0 + s1) + (s2 + s3);
}

/** Solves A·d = b for a symmetric positive-definite A (row-major k×k). A is overwritten. */
function choleskySolve(A: Float64Array, b: Float64Array, k: number): Float64Array {
  // A = L·Lᵀ, L stored in the lower triangle of A.
  for (let j = 0; j < k; j++) {
    const rj = j * k;
    const ljj = Math.sqrt(A[rj + j] - dot(A, rj, rj, j));
    A[rj + j] = ljj;
    for (let i = j + 1; i < k; i++) { const ri = i * k; A[ri + j] = (A[ri + j] - dot(A, ri, rj, j)) / ljj; }
  }
  const y = new Float64Array(k);
  for (let i = 0; i < k; i++) y[i] = (b[i] - dot2(A, i * k, y, i)) / A[i * k + i];
  const d = new Float64Array(k);
  for (let i = k - 1; i >= 0; i--) {
    let t = y[i];
    for (let m = i + 1; m < k; m++) t -= A[m * k + i] * d[m];
    d[i] = t / A[i * k + i];
  }
  return d;
}

/** Σ A[a+m]·v[m] for m < n. */
function dot2(A: Float64Array, a: number, v: Float64Array, n: number): number {
  let t = 0;
  for (let m = 0; m < n; m++) t += A[a + m] * v[m];
  return t;
}
