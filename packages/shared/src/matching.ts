import type { Category } from './types';

/** Lowercase, drop apostrophes and punctuation, collapse spaces, ignore a leading "the/a/an". */
export function normTitle(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) (?=\S)/, '');
}

/** Dice coefficient on letter pairs: 1 = identical, near 0 = unrelated. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pairs = (s: string) => {
    const p = new Map<string, number>();
    const t = s.replace(/ /g, '');
    for (let i = 0; i < t.length - 1; i++) {
      const k = t.slice(i, i + 2);
      p.set(k, (p.get(k) || 0) + 1);
    }
    return p;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  let overlap = 0;
  let total = 0;
  pa.forEach((n, k) => {
    overlap += Math.min(n, pb.get(k) || 0);
    total += n;
  });
  pb.forEach((n) => {
    total += n;
  });
  return total ? (2 * overlap) / total : 0;
}

/** "Speed Racer 2008" / "Speed Racer (2008)" -> { name: "Speed Racer", year: "2008" } */
export function splitYear(t: string, now: Date = new Date()): { name: string; year: string } {
  const m = String(t).match(/^(.*?)[\s(\[]*\b((?:19|20)\d{2})\b[)\]]*\s*$/);
  // Only a plausible release year counts, so "Blade Runner 2049" keeps its name.
  const ok = m && m[1]!.trim() && Number(m[2]) <= now.getFullYear() + 2;
  return ok ? { name: m[1]!.trim(), year: m[2]! } : { name: String(t).trim(), year: '' };
}

const EDITION_WORD =
  /remaster|deluxe|edition|anniversary|expanded|bonus|version|\bmono\b|\bstereo\b|reissue/i;

/**
 * Removes trailing "(...)", "[...]" or " - ..." groups that mention an edition keyword,
 * e.g. "Abbey Road (Remastered 2019)" -> "Abbey Road". "live" is deliberately not a keyword.
 */
export function stripEdition(t: string): string {
  let s = String(t).trim();
  for (;;) {
    let next = s;
    const m = s.match(/^(.*?)\s*(?:\(([^()]*)\)|\[([^\[\]]*)\])$/) ?? s.match(/^(.*?)\s+-\s+([^-]*)$/);
    if (m) {
      const inner = m[2] ?? m[3] ?? '';
      if (EDITION_WORD.test(inner) && m[1]!.trim()) next = m[1]!.trim();
    }
    if (next === s) return s;
    s = next;
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, n: string) => ENTITIES[n]!)
    .replace(/&amp;/g, '&');
}

/** Strips HTML, collapses whitespace, and cuts long text at a sentence end (or a space) with "…". */
export function trimSynopsis(s: string, max: number): string {
  const text = decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const win = text.slice(0, max + 1);
  const end = Math.max(...['. ', '! ', '? '].map((p) => win.lastIndexOf(p)));
  if (end > 0 && end < max) return text.slice(0, end + 1) + '…';
  const sp = text.lastIndexOf(' ', max - 1);
  return (sp > 0 ? text.slice(0, sp) : text.slice(0, max)) + '…';
}

interface DupRow {
  id: string;
  title: string;
  creator: string;
}

/**
 * Finds another row with the same normalized title. Every category except anime and tv also
 * compares creators; until the candidate has a creator it isn't flagged.
 */
export function findDuplicate(
  rows: DupRow[],
  cand: { id?: string; title: string; creator: string },
  category: Category,
): string | null {
  const key = normTitle(cand.title);
  if (!key) return null;
  const byCreator = category !== 'anime' && category !== 'tv';
  const who = normTitle(cand.creator);
  if (byCreator && !who) return null;
  const hit = rows.find(
    (r) => r.id !== cand.id && normTitle(r.title) === key && (!byCreator || normTitle(r.creator) === who),
  );
  return hit ? hit.id : null;
}
