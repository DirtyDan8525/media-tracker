import readExcel from 'read-excel-file/universal';
import {
  CATEGORY_CONFIG,
  COMPARE_ASK,
  COMPARE_ROOM,
  COMPARE_STYLE,
  STATUSES,
  THEMES,
  normTitle,
  type Category,
  type ImportPreview,
  type ImportRow,
  type Status,
  type UserSettings,
} from '@media-tracker/shared';

type Raw = unknown;
type Grid = Raw[][];
type Warn = ImportPreview['warnings'][number];

// String bounds mirror the worker's entryValidation (kept in step by hand; the
// worker re-validates every row, so a drift shows up as a rejected chunk, not bad data).
const MAX = { title: 300, text: 300, notes: 5000, cover: 2000, season: 100 } as const;
const HEADER_SCAN_ROWS = 5;

// Script TAB_SWITCHES labels -> UserSettings.tabs keys.
const TAB_LABELS: Record<string, string> = {
  'movies': 'movies',
  'tv shows': 'tv',
  'tv seasons': 'tvSeasons',
  'anime seasons': 'animeSeasons',
  'albums': 'albums',
  'songs': 'songs',
  'games': 'games',
  'books': 'books',
};
const COLOR_ROLES = Object.keys(THEMES.Midnight!);

type Kind = Category | 'animeSeasons' | 'tvSeasons';
const KIND_LABEL: Record<Kind, string> = {
  anime: 'Anime', movies: 'Movies', tv: 'TV', albums: 'Albums', songs: 'Songs', games: 'Games', books: 'Books',
  animeSeasons: 'Anime Seasons', tvSeasons: 'TV Seasons',
};

const norm = (v: Raw) => String(v ?? '').trim().toLowerCase();

/** Cell -> trimmed text. Numbers/booleans are stringified, dates and blanks become ''. */
function text(v: Raw): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function classify(headers: string[]): Kind | null {
  const has = (h: string) => headers.includes(h);
  if (headers[0] === 'anime' && headers.slice(1).some((h) => h.startsWith('season'))) return 'animeSeasons';
  if (headers[0] === 'show' && headers.slice(1).some((h) => h.startsWith('season'))) return 'tvSeasons';
  if (has('title')) {
    if (has('studio')) return 'anime';
    if (has('director')) return 'movies';
    if (has('developer')) return 'games';
    if (has('author')) return 'books';
    if (has('status') && has('season avg')) return 'tv';
  }
  if (has('album') && has('artist') && !has('song')) return 'albums';
  if (has('song') && has('artist')) return 'songs';
  return null;
}

function findHeader(grid: Grid): { kind: Kind; headerIdx: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, grid.length); i++) {
    const headers = (grid[i] ?? []).map(norm);
    const kind = classify(headers);
    if (kind) return { kind, headerIdx: i, headers };
  }
  return null;
}

const isSettingsSheet = (grid: Grid) =>
  grid.some((r) => {
    const label = norm(r?.[1]);
    return label === 'theme' || label in TAB_LABELS;
  });

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function parseWorkbook(buf: ArrayBuffer): Promise<ImportPreview> {
  const sheets = await readExcel(buf);
  const rows: ImportRow[] = [];
  const skipped: ImportPreview['skipped'] = [];
  const warnings: Warn[] = [];
  let settings: Partial<UserSettings> | null = null;

  const warn = (tab: string, row: number, message: string) => warnings.push({ tab, row, message });

  /** Number 0-10 rounded to 2 decimals, or null (with a warning unless the cell is blank). */
  function parseRating(v: Raw, tab: string, row: number): number | null {
    if (v === null || v === undefined) return null;
    let n: number;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string') {
      const s = v.trim();
      if (s === '') return null;
      n = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s) ? Number(s.replace(',', '.')) : NaN;
    } else n = NaN;
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      warn(tab, row, `Rating "${text(v)}" is not a number from 0 to 10; imported without a rating.`);
      return null;
    }
    const r = round2(n);
    if (Math.abs(r - n) > 1e-9) warn(tab, row, `Rating ${n} was rounded to ${r}.`);
    return r;
  }

  function bounded(v: Raw, max: number, field: string, tab: string, row: number): string {
    const s = text(v);
    if (s.length <= max) return s;
    warn(tab, row, `${field} was longer than ${max} characters and was shortened.`);
    return s.slice(0, max);
  }

  function parseStatus(v: Raw, tab: string, row: number): Status | null {
    const s = text(v);
    if (s === '') return null;
    const hit = STATUSES.find((x) => x.toLowerCase() === s.toLowerCase());
    if (hit) return hit;
    warn(tab, row, `Status "${s}" is not one of the known statuses; imported without a status.`);
    return null;
  }

  function parseCover(v: Raw, tab: string, row: number): string {
    const s = text(v);
    if (s === '') return '';
    let ok = false;
    try {
      const p = new URL(s).protocol;
      ok = p === 'http:' || p === 'https:';
    } catch { /* not a URL */ }
    if (!ok || s.length > MAX.cover) {
      warn(tab, row, 'Cover URL is not a usable http(s) link (or is too long); imported without a cover.');
      return '';
    }
    return s;
  }

  const seen = new Set<Kind>();
  const seasonSheets: { tab: string; kind: 'animeSeasons' | 'tvSeasons'; grid: Grid; headerIdx: number; headers: string[] }[] = [];
  let settingsGrid: { tab: string; grid: Grid } | null = null;

  for (const { sheet: tab, data } of sheets) {
    const grid = data as Grid;
    const found = findHeader(grid);
    if (!found) {
      if (isSettingsSheet(grid)) {
        if (settingsGrid) warn(tab, 1, 'A second Settings tab was found; it was ignored.');
        else settingsGrid = { tab, grid };
      }
      continue; // Start Here, Top 5, Stats, Lists, ...
    }
    const { kind, headerIdx, headers } = found;
    if (seen.has(kind)) {
      warn(tab, headerIdx + 1, `Another tab was already detected as ${KIND_LABEL[kind]}; this one's rows were imported too.`);
    }
    seen.add(kind);
    if (kind === 'animeSeasons' || kind === 'tvSeasons') {
      seasonSheets.push({ tab, kind, grid, headerIdx, headers });
      continue;
    }

    const cfg = CATEGORY_CONFIG[kind];
    const col = (name: string) => headers.indexOf(name);
    const titleCol = col(cfg.titleLabel.toLowerCase());
    const c = {
      rating: col('rating'),
      status: cfg.hasStatus ? col('status') : -1,
      genres: col('genres'),
      creator: cfg.creatorLabel ? col(cfg.creatorLabel.toLowerCase()) : -1,
      album: kind === 'songs' ? col('album') : -1,
      notes: col('notes'),
      cover: col('cover url'),
    };
    const get = (r: Raw[], i: number): Raw => (i >= 0 ? r[i] : null);

    for (let i = headerIdx + 1; i < grid.length; i++) {
      const r = grid[i] ?? [];
      const rowNo = i + 1;
      const title = bounded(r[titleCol], MAX.title, 'Title', tab, rowNo);
      if (title === '') continue; // blank row
      rows.push({
        category: kind,
        title,
        status: parseStatus(get(r, c.status), tab, rowNo),
        rating: parseRating(get(r, c.rating), tab, rowNo),
        genres: bounded(get(r, c.genres), MAX.text, 'Genres', tab, rowNo),
        creator: bounded(get(r, c.creator), MAX.text, cfg.creatorLabel ?? 'Creator', tab, rowNo),
        album: bounded(get(r, c.album), MAX.text, 'Album', tab, rowNo),
        coverUrl: parseCover(get(r, c.cover), tab, rowNo),
        notes: bounded(get(r, c.notes), MAX.notes, 'Notes', tab, rowNo),
      });
    }
  }

  // Seasons, attached by normTitle once every list tab has been read.
  const byTitle = {
    anime: new Map<string, ImportRow>(),
    tv: new Map<string, ImportRow>(),
  };
  for (const r of rows) {
    if (r.category !== 'anime' && r.category !== 'tv') continue;
    const key = normTitle(r.title);
    if (key && !byTitle[r.category].has(key)) byTitle[r.category].set(key, r);
  }
  for (const { tab, kind, grid, headerIdx, headers } of seasonSheets) {
    const target = byTitle[kind === 'animeSeasons' ? 'anime' : 'tv'];
    const seasonCol = headers.findIndex((h, i) => i > 0 && h.startsWith('season'));
    const ratingCol = headers.indexOf('rating');
    const notesCol = headers.indexOf('notes');
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const r = grid[i] ?? [];
      const rowNo = i + 1;
      if (r.every((v) => text(v) === '')) continue; // blank row
      const owner = target.get(normTitle(text(r[0])));
      if (!owner) {
        skipped.push({ tab, row: rowNo, reason: 'no matching show' });
        continue;
      }
      (owner.seasons ??= []).push({
        label: bounded(r[seasonCol], MAX.season, 'Season', tab, rowNo),
        rating: parseRating(ratingCol >= 0 ? r[ratingCol] : null, tab, rowNo),
        notes: bounded(notesCol >= 0 ? r[notesCol] : null, MAX.notes, 'Notes', tab, rowNo),
      });
    }
  }

  if (settingsGrid) settings = readSettings(settingsGrid.tab, settingsGrid.grid, warn);

  const counts: ImportPreview['counts'] = {};
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;
  return { rows, counts, skipped, warnings, settings };
}

/** Reads Settings the way the script's readSettings_ does: labels in column B, values in column C. */
function readSettings(
  tab: string,
  grid: Grid,
  warn: (tab: string, row: number, message: string) => void,
): Partial<UserSettings> {
  const out: Partial<UserSettings> = {};
  const colors: Record<string, string> = {};
  const tabs: Record<string, boolean> = {};
  const oneOf = <T extends string>(
    key: 'compareAsk' | 'compareStyle' | 'compareRoom',
    label: string,
    allowed: readonly T[],
    v: string,
    row: number,
  ) => {
    if (v === '') return;
    const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
    if (hit) out[key] = hit;
    else warn(tab, row, `${label} "${v}" is not a known option; that setting was not imported.`);
  };

  grid.forEach((r, i) => {
    const rowNo = i + 1;
    const rawLabel = text(r?.[1]);
    const label = rawLabel.toLowerCase();
    const value = r?.[2];
    const v = text(value);
    if (label in TAB_LABELS) {
      tabs[TAB_LABELS[label]!] = value === true || v.toUpperCase() === 'TRUE';
    } else if (label === 'theme') {
      if (v === '') return;
      const hit = [...Object.keys(THEMES), 'Custom'].find((t) => t.toLowerCase() === v.toLowerCase());
      if (hit) out.theme = hit;
      else warn(tab, rowNo, `Theme "${v}" is not a known theme; that setting was not imported.`);
    } else if (COLOR_ROLES.some((k) => k.toLowerCase() === label)) {
      const role = COLOR_ROLES.find((k) => k.toLowerCase() === label)!;
      if (v === '') return;
      const hex = v.toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(hex)) colors[role] = hex;
      else warn(tab, rowNo, `${role} colour "${v}" is not a #rrggbb hex value; that colour was not imported.`);
    } else if (label === 'ask to compare') oneOf('compareAsk', rawLabel, COMPARE_ASK, v, rowNo);
    else if (label === 're-rating style') oneOf('compareStyle', rawLabel, COMPARE_STYLE, v, rowNo);
    else if (label === "when there's no room") oneOf('compareRoom', rawLabel, COMPARE_ROOM, v, rowNo);
    else if (label === 'compare within') {
      const n = Number(typeof value === 'string' ? value.replace(',', '.') : value);
      out.compareWindow = Math.min(n > 0 ? n : 1, 10); // script: Number(x) > 0 ? Number(x) : 1
    }
  });
  if (Object.keys(tabs).length) out.tabs = tabs;
  if (Object.keys(colors).length) out.colors = colors;
  return out;
}
