import { formatRating, ratingColor, type CfSet, type ThemeColors } from '@media-tracker/shared';
import { labelColorOn } from '../design/theme';

/**
 * B17 share card (ShareTop5 / ShareNumberOnes boards, Top5.v2 styling): a 1080 × 1350 image drawn with
 * Canvas 2D from the theme's colours. A Top 5 card has #1 as a large poster over its own blurred cover,
 * 2–3 as standard rows and 4–5 compact; a "My #1s" card has one row per list, each with a gold disc and
 * its list name. Ranks 1/2/3 are medal discs; a small "Media Tracker · @username" footer closes it.
 * Text is Bright text / Text / Muted text on Background or Cards (≥ 4.5:1 in every built-in theme);
 * over the poster's backdrop only Bright text and Text are used.
 */

export const CARD_W = 1080;
export const CARD_H = 1350;
/** Gold, silver, bronze for ranks 1, 2, 3 (design notes). */
export const MEDALS = ['#f2c14e', '#c9cfd9', '#e0925a'] as const;
/** The numeral on a medal disc: ≥ 4.5:1 on all three medals. */
export const MEDAL_INK = '#1b1b25';

export interface CardRow {
  rank: number;
  /** "My #1s": the row's list ("Anime"), shown above the title. */
  listLabel?: string;
  title: string;
  creator: string;
  rating: number;
  /** Albums and songs have square covers; everything else is a 2:3 poster. */
  square: boolean;
  /** null: the cover could not be loaded (or there is none): a Panels tile with the title's first letter. */
  cover: CanvasImageSource | null;
}

export interface CardInput {
  kind: 'top5' | 'ones';
  heading: string;
  username: string;
  rows: CardRow[];
  colors: ThemeColors;
  cf: CfSet;
}

export type CardCtx = Pick<CanvasRenderingContext2D, 'fillStyle' | 'font' | 'textBaseline' | 'textAlign' | 'fillRect' | 'fillText'
  | 'measureText' | 'drawImage' | 'beginPath' | 'roundRect' | 'fill' | 'save' | 'restore' | 'clip' | 'globalAlpha' | 'filter'>;

export type BoxStyle = 'poster' | 'row' | 'compact';
export interface CardBox { y: number; h: number; style: BoxStyle }

// Geometry (px on the 1080 × 1350 canvas).
const PAD = 72;
const INNER_W = CARD_W - 2 * PAD;
const HEADING_SIZE = 64;
/** Rows start under the heading. */
const TOP = PAD + HEADING_SIZE + 24;
const FOOTER_H = 60;
/** Every row box ends at or above this line; the footer sits below it. */
const BOTTOM = CARD_H - PAD - FOOTER_H;
const GAP = 16;
const RADIUS = 24;
const ROW_H = 170;
const COMPACT_H = 110;
/** The poster is 520 high on the board's scale, but must leave room for 2–5 within BOTTOM: 434. */
const POSTER_H = Math.min(520, BOTTOM - TOP - 2 * ROW_H - 2 * COMPACT_H - 4 * GAP);
const ROW_PAD = 24;
const DISC = 64;
const BADGE_W = 128;
const BADGE_H = 72;
const BADGE_R = 16;
const BADGE_X = PAD + INNER_W - ROW_PAD - BADGE_W;
const TOP5_STYLES: BoxStyle[] = ['poster', 'row', 'row', 'compact', 'compact'];

const font = (weight: 400 | 500 | 700 | 800, size: number) => `${weight} ${size}px Inter`;

/** `text` cut with "…" so it measures within `maxWidth` in the current font ('' when not even "…" fits). */
export function fitText(ctx: CardCtx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  // The longest prefix that fits with the ellipsis.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${chars.slice(0, mid).join('').trimEnd()}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return ctx.measureText('…').width <= maxWidth ? '…' : '';
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/** Up to two lines: words while they fit, the rest cut with "…". */
function wrapTwo(ctx: CardCtx, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  let first = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = first ? `${first} ${words[i]}` : words[i]!;
    if (ctx.measureText(next).width > maxWidth) break;
    first = next;
  }
  if (!first) return [fitText(ctx, text, maxWidth)];
  return [first, fitText(ctx, words.slice(i).join(' '), maxWidth)];
}

/** The row boxes, top to bottom. Top 5: poster, row, row, compact, compact; #1s: rows sharing the height. */
export function cardLayout(input: Pick<CardInput, 'kind'> & { n: number }): CardBox[] {
  const out: CardBox[] = [];
  let y = TOP;
  if (input.kind === 'top5') {
    for (const style of TOP5_STYLES.slice(0, Math.max(0, input.n))) {
      const h = style === 'poster' ? POSTER_H : style === 'row' ? ROW_H : COMPACT_H;
      out.push({ y, h, style });
      y += h + GAP;
    }
    return out;
  }
  const n = Math.max(0, input.n);
  const h = n === 0 ? 0 : Math.min(ROW_H, Math.floor((BOTTOM - TOP - GAP * (n - 1)) / n));
  for (let i = 0; i < n; i++) {
    out.push({ y, h, style: 'row' });
    y += h + GAP;
  }
  return out;
}

function roundRect(ctx: CardCtx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** Width and height of an image source, when it says. */
function sizeOf(img: CanvasImageSource): { w: number; h: number } | null {
  const o = img as { naturalWidth?: unknown; naturalHeight?: unknown; width?: unknown; height?: unknown };
  const w = typeof o.naturalWidth === 'number' && o.naturalWidth > 0 ? o.naturalWidth : o.width;
  const h = typeof o.naturalHeight === 'number' && o.naturalHeight > 0 ? o.naturalHeight : o.height;
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { w, h } : null;
}

/** Draws `img` to fill the destination rect, cropping the source to its aspect (object-fit: cover). */
function drawCover(ctx: CardCtx, img: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) {
  const s = sizeOf(img);
  if (!s) {
    ctx.drawImage(img, dx, dy, dw, dh);
    return;
  }
  const scale = Math.max(dw / s.w, dh / s.h);
  const sw = dw / scale;
  const sh = dh / scale;
  ctx.drawImage(img, (s.w - sw) / 2, (s.h - sh) / 2, sw, sh, dx, dy, dw, dh);
}

/** A cover (or its placeholder) with rounded corners. */
function drawCoverTile(ctx: CardCtx, row: CardRow, x: number, y: number, w: number, h: number, colors: ThemeColors) {
  const r = Math.max(8, Math.round(w * 0.08));
  if (!row.cover) {
    roundRect(ctx, x, y, w, h, r, colors.Panels!);
    const letter = [...row.title.trim()][0]?.toUpperCase();
    if (letter) {
      ctx.font = font(700, Math.round(Math.min(w, h) * 0.4));
      ctx.fillStyle = colors.Text!;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, x + w / 2, y + h / 2);
    }
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  drawCover(ctx, row.cover, x, y, w, h);
  ctx.restore();
}

/** The rank: a medal disc with a dark numeral for 1–3, a plain Muted text numeral for 4–5. */
function drawRank(ctx: CardCtx, rank: number, cx: number, cy: number, colors: ThemeColors) {
  const medal = MEDALS[rank - 1];
  if (medal) roundRect(ctx, cx - DISC / 2, cy - DISC / 2, DISC, DISC, DISC / 2, medal);
  ctx.font = font(800, 36);
  ctx.fillStyle = medal ? MEDAL_INK : colors['Muted text']!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), cx, cy + 1);
}

function drawBadge(ctx: CardCtx, rating: number, y: number, input: CardInput) {
  const fill = ratingColor(rating, input.cf);
  roundRect(ctx, BADGE_X, y, BADGE_W, BADGE_H, BADGE_R, fill);
  ctx.font = font(700, 40);
  ctx.fillStyle = labelColorOn(fill, input.colors);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatRating(rating), BADGE_X + BADGE_W / 2, y + BADGE_H / 2 + 1);
}

interface Line { text: string; font: string; color: string; size: number }

/** Lines stacked from `y` (8 px apart), left-aligned at `x`. */
function drawLines(ctx: CardCtx, lines: Line[], x: number, y: number) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let at = y;
  for (const l of lines) {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, x, at);
    at += l.size + 8;
  }
}
const linesHeight = (lines: { size: number }[]) => lines.reduce((s, l) => s + l.size, 0) + 8 * Math.max(0, lines.length - 1);

/**
 * The blurred cover behind the poster. Where the canvas has no `filter` (older Safari), the cover is
 * drawn into a 24 px canvas and scaled back up, which blurs it just as well.
 */
function drawBackdrop(ctx: CardCtx, img: CanvasImageSource, box: CardBox) {
  const [x, y, w, h] = [PAD - 60, box.y - 60, INNER_W + 120, box.h + 120];
  if ('filter' in ctx) {
    ctx.filter = 'blur(40px)';
    drawCover(ctx, img, x, y, w, h);
    ctx.filter = 'none';
    return;
  }
  const s = sizeOf(img) ?? { w: 2, h: 3 };
  const small = document.createElement('canvas');
  small.width = s.w >= s.h ? 24 : Math.max(1, Math.round((24 * s.w) / s.h));
  small.height = s.h > s.w ? 24 : Math.max(1, Math.round((24 * s.h) / s.w));
  const sctx = small.getContext('2d');
  if (!sctx) return;
  sctx.drawImage(img, 0, 0, small.width, small.height);
  drawCover(ctx, small, x, y, w, h);
}

function drawPoster(ctx: CardCtx, row: CardRow, box: CardBox, input: CardInput) {
  const { colors } = input;
  roundRect(ctx, PAD, box.y, INNER_W, box.h, RADIUS, colors.Cards!);
  if (row.cover) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(PAD, box.y, INNER_W, box.h, RADIUS);
    ctx.clip();
    drawBackdrop(ctx, row.cover, box);
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = colors.Background!;
    ctx.fillRect(PAD, box.y, INNER_W, box.h);
    ctx.restore();
  }
  const coverH = Math.min(390, box.h - 2 * ROW_PAD);
  const coverW = row.square ? coverH : Math.round((coverH * 2) / 3);
  const cx = PAD + ROW_PAD;
  drawCoverTile(ctx, row, cx, box.y + (box.h - coverH) / 2, coverW, coverH, colors);

  const tx = cx + coverW + 32;
  const maxW = BADGE_X - 24 - tx;
  ctx.font = font(700, 52);
  const title = wrapTwo(ctx, row.title, maxW);
  ctx.font = font(400, 32);
  const creator = row.creator.trim() ? fitText(ctx, row.creator, maxW) : '';
  const lines: Line[] = [
    ...(row.listLabel ? [{ text: row.listLabel, font: font(700, 28), color: colors.Text!, size: 28 }] : []),
    ...title.filter(Boolean).map((t) => ({ text: t, font: font(700, 52), color: colors['Bright text']!, size: 52 })),
    ...(creator ? [{ text: creator, font: font(400, 32), color: colors.Text!, size: 32 }] : []),
  ];
  const blockH = DISC + 20 + linesHeight(lines);
  const top = box.y + (box.h - blockH) / 2;
  drawRank(ctx, row.rank, tx + DISC / 2, top + DISC / 2, colors);
  drawLines(ctx, lines, tx, top + DISC + 20);
  drawBadge(ctx, row.rating, box.y + (box.h - BADGE_H) / 2, input);
}

function drawRow(ctx: CardCtx, row: CardRow, box: CardBox, input: CardInput) {
  const { colors } = input;
  roundRect(ctx, PAD, box.y, INNER_W, box.h, RADIUS, colors.Cards!);
  const cy = box.y + box.h / 2;
  const discX = PAD + ROW_PAD;
  drawRank(ctx, row.rank, discX + DISC / 2, cy, colors);

  const coverH = Math.min(box.style === 'compact' ? 90 : 144, box.h - 2 * 12);
  const coverW = row.square ? coverH : Math.round((coverH * 2) / 3);
  const coverX = discX + DISC + 24;
  drawCoverTile(ctx, row, coverX, cy - coverH / 2, coverW, coverH, colors);

  const tx = coverX + coverW + 24;
  const maxW = BADGE_X - 24 - tx;
  const fitted = (text: string, f: string) => { ctx.font = f; return fitText(ctx, text, maxW); };
  const lines: Line[] = [];
  if (row.listLabel) lines.push({ text: fitted(row.listLabel, font(700, 28)), font: font(700, 28), color: colors['Muted text']!, size: 28 });
  lines.push({ text: fitted(row.title, font(700, 44)), font: font(700, 44), color: colors['Bright text']!, size: 44 });
  if (row.creator.trim()) lines.push({ text: fitted(row.creator, font(400, 32)), font: font(400, 32), color: colors['Muted text']!, size: 32 });
  const shown = lines.filter((l) => l.text);
  drawLines(ctx, shown, tx, cy - linesHeight(shown) / 2);
  drawBadge(ctx, row.rating, cy - BADGE_H / 2, input);
}

/** Draws the whole card: Background, heading, the rows (only as many as given), footer. */
export function drawShareCard(ctx: CardCtx, input: CardInput): void {
  const { colors } = input;
  ctx.globalAlpha = 1;
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.fillStyle = colors.Background!;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.font = font(800, HEADING_SIZE);
  ctx.fillStyle = colors['Bright text']!;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, input.heading, INNER_W), PAD, PAD);

  const boxes = cardLayout({ kind: input.kind, n: input.rows.length });
  boxes.forEach((box, i) => {
    const row = input.rows[i]!;
    if (box.style === 'poster') drawPoster(ctx, row, box, input);
    else drawRow(ctx, row, box, input);
  });

  ctx.font = font(500, 28);
  ctx.fillStyle = colors['Muted text']!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const footer = input.username ? `Media Tracker · @${input.username}` : 'Media Tracker';
  ctx.fillText(fitText(ctx, footer, INNER_W), CARD_W / 2, BOTTOM + (FOOTER_H - 28) / 2);
}
