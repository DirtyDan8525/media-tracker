import { PRIOR_SD, sigmoid } from './score';
import type { Comparison, RatedItem } from './types';

type FitItem = Pick<RatedItem, 'id' | 'priorMean' | 'scoreLocked'>;
type FitComparison = Pick<Comparison, 'winnerId' | 'loserId' | 'isTie' | 'undoneAt'>;

const MAX_STEPS = 100;
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
 */
export function fitTier(items: FitItem[], comparisons: FitComparison[], opts?: { priorSd?: number }): Map<string, number> {
  const sd = opts?.priorSd ?? PRIOR_SD;
  const invVar = 1 / (sd * sd);
  const sorted = [...items].sort((a, b) => cmpStr(a.id, b.id));
  const ids = new Set(sorted.map((i) => i.id));
  const picks = countedPicks(ids, comparisons);

  const s = new Map<string, number>();
  for (const it of sorted) s.set(it.id, it.priorMean ?? 0);

  const inPick = new Set<string>();
  for (const p of picks) { inPick.add(p.winnerId); inPick.add(p.loserId); }
  const free = sorted.filter((it) => inPick.has(it.id) && !it.scoreLocked);
  const k = free.length;
  if (k === 0) return s;

  const idx = new Map<string, number>(free.map((it, i) => [it.id, i]));
  const mu = free.map((it) => it.priorMean ?? 0);
  const x = mu.slice();
  const val = (id: string): number => { const i = idx.get(id); return i === undefined ? s.get(id)! : x[i]; };

  const g = new Float64Array(k);
  const H = new Float64Array(k * k);
  for (let step = 0; step < MAX_STEPS; step++) {
    H.fill(0);
    for (let i = 0; i < k; i++) { g[i] = -(x[i] - mu[i]) * invVar; H[i * k + i] = invVar; }
    for (const p of picks) {
      const w = idx.get(p.winnerId), l = idx.get(p.loserId);
      const pr = sigmoid(val(p.winnerId) - val(p.loserId));
      const r = (p.isTie ? 0.5 : 1) - pr;
      const h = pr * (1 - pr);
      if (w !== undefined) { g[w] += r; H[w * k + w] += h; }
      if (l !== undefined) { g[l] -= r; H[l * k + l] += h; }
      if (w !== undefined && l !== undefined) { H[w * k + l] -= h; H[l * k + w] -= h; }
    }
    const d = choleskySolve(H, g, k);
    let max = 0;
    for (let i = 0; i < k; i++) { x[i] += d[i]; max = Math.max(max, Math.abs(d[i])); }
    if (max < TOLERANCE) break;
  }
  for (let i = 0; i < k; i++) s.set(free[i].id, x[i]);
  return s;
}

/** Solves A·d = b for a symmetric positive-definite A (row-major k×k). A is overwritten. */
function choleskySolve(A: Float64Array, b: Float64Array, k: number): Float64Array {
  // A = L·Lᵀ, L stored in the lower triangle of A.
  for (let j = 0; j < k; j++) {
    let sum = A[j * k + j];
    for (let m = 0; m < j; m++) sum -= A[j * k + m] * A[j * k + m];
    const ljj = Math.sqrt(sum);
    A[j * k + j] = ljj;
    for (let i = j + 1; i < k; i++) {
      let t = A[i * k + j];
      for (let m = 0; m < j; m++) t -= A[i * k + m] * A[j * k + m];
      A[i * k + j] = t / ljj;
    }
  }
  const y = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    let t = b[i];
    for (let m = 0; m < i; m++) t -= A[i * k + m] * y[m];
    y[i] = t / A[i * k + i];
  }
  const d = new Float64Array(k);
  for (let i = k - 1; i >= 0; i--) {
    let t = y[i];
    for (let m = i + 1; m < k; m++) t -= A[m * k + i] * d[m];
    d[i] = t / A[i * k + i];
  }
  return d;
}
