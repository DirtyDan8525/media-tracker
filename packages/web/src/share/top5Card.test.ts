import { cfSetFor, formatRating, ratingColor, THEMES, type ThemeColors } from '@media-tracker/shared';
import { describe, expect, it, vi } from 'vitest';
import { contrast, labelColorOn } from '../design/theme';
import {
  CARD_H, CARD_W, cardLayout, drawShareCard, fitText, MEDAL_INK, MEDALS,
  type CardCtx, type CardInput, type CardRow,
} from './top5Card';

/** One recorded call with the drawing state it ran under. */
interface Op {
  op: string;
  args: unknown[];
  fillStyle: string;
  font: string;
  globalAlpha: number;
  filter: string;
  textAlign: string;
}

/** A CardCtx that records every call; text is 20 px a character wide. */
function fakeCtx(opts: { filter?: boolean } = {}) {
  const ops: Op[] = [];
  type State = { fillStyle: string; font: string; globalAlpha: number; filter: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline };
  let state: State = { fillStyle: '#000000', font: '10px sans-serif', globalAlpha: 1, filter: 'none', textAlign: 'start', textBaseline: 'alphabetic' };
  const stack: State[] = [];
  const rec = (op: string) => (...args: unknown[]) => {
    ops.push({ op, args, fillStyle: state.fillStyle, font: state.font, globalAlpha: state.globalAlpha, filter: state.filter, textAlign: state.textAlign });
  };
  const ctx = {
    get fillStyle() { return state.fillStyle; }, set fillStyle(v: string) { state.fillStyle = v; },
    get font() { return state.font; }, set font(v: string) { state.font = v; },
    get globalAlpha() { return state.globalAlpha; }, set globalAlpha(v: number) { state.globalAlpha = v; },
    get textAlign() { return state.textAlign; }, set textAlign(v: CanvasTextAlign) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; }, set textBaseline(v: CanvasTextBaseline) { state.textBaseline = v; },
    fillRect: rec('fillRect'),
    fillText: rec('fillText'),
    drawImage: rec('drawImage'),
    beginPath: rec('beginPath'),
    roundRect: rec('roundRect'),
    fill: rec('fill'),
    clip: rec('clip'),
    save: () => { stack.push({ ...state }); rec('save')(); },
    restore: () => { state = stack.pop() ?? state; rec('restore')(); },
    measureText: (t: string) => ({ width: t.length * 20 }) as TextMetrics,
  } as Record<string, unknown>;
  if (opts.filter !== false) {
    Object.defineProperty(ctx, 'filter', { get: () => state.filter, set: (v: string) => { state.filter = v; }, enumerable: true });
  }
  return { ctx: ctx as unknown as CardCtx, ops };
}

const MIDNIGHT = THEMES.Midnight!;
const cf = cfSetFor('Midnight');
const cover = { width: 300, height: 450 } as unknown as ImageBitmap;

const row = (rank: number, over: Partial<CardRow> = {}): CardRow => ({
  rank, title: `Title ${rank}`, creator: `Studio ${rank}`, rating: 10 - rank * 0.5, square: false, cover: null, ...over,
});

const input = (over: Partial<CardInput> = {}): CardInput => ({
  kind: 'top5', heading: 'My Anime Top 5', username: 'dan',
  rows: [1, 2, 3, 4, 5].map((r) => row(r)), colors: MIDNIGHT, cf, ...over,
});

const texts = (ops: Op[]) => ops.filter((o) => o.op === 'fillText').map((o) => o.args[0] as string);
/** Fills of shapes (roundRect + fill) and rects, with the colour they used. */
const fills = (ops: Op[]) => ops.filter((o) => o.op === 'fill' || o.op === 'fillRect');

describe('fitText', () => {
  it('keeps short text and ends long text with "…" within maxWidth', () => {
    const { ctx } = fakeCtx();
    expect(fitText(ctx, 'Frieren', 400)).toBe('Frieren');
    const long = 'Frieren: Beyond Journey\'s End, the very long director\'s cut edition';
    const fitted = fitText(ctx, long, 400);
    expect(fitted.endsWith('…')).toBe(true);
    expect(fitted.length * 20).toBeLessThanOrEqual(400);
    expect(long.startsWith(fitted.slice(0, -1).trimEnd())).toBe(true);
    expect(fitText(ctx, 'anything', 10)).toBe('');
  });
});

describe('drawShareCard', () => {
  it('draws "My Anime Top 5", the footer "Media Tracker · @dan", ranks 1–5, each title, creator and formatRating(rating)', () => {
    const { ctx, ops } = fakeCtx();
    const rows = [1, 2, 3, 4, 5].map((r) => row(r));
    drawShareCard(ctx, input({ rows }));
    const t = texts(ops);
    expect(t).toContain('My Anime Top 5');
    expect(t).toContain('Media Tracker · @dan');
    for (const r of rows) {
      expect(t).toContain(String(r.rank));
      expect(t).toContain(r.title);
      expect(t).toContain(r.creator);
      expect(t).toContain(formatRating(r.rating));
    }
    const footer = ops.find((o) => o.op === 'fillText' && o.args[0] === 'Media Tracker · @dan')!;
    expect(footer.fillStyle).toBe(MIDNIGHT['Muted text']);
    expect(footer.textAlign).toBe('center');
    expect(footer.args[1]).toBe(CARD_W / 2);
    const heading = ops.find((o) => o.op === 'fillText' && o.args[0] === 'My Anime Top 5')!;
    expect(heading.fillStyle).toBe(MIDNIGHT['Bright text']);
    expect(heading.font).toMatch(/^800 64px Inter/);
  });

  it('the first fill is the theme\'s Background and row fills are Cards', () => {
    const { ctx, ops } = fakeCtx();
    drawShareCard(ctx, input());
    const f = fills(ops);
    expect(f[0]!.op).toBe('fillRect');
    expect(f[0]!.args).toEqual([0, 0, CARD_W, CARD_H]);
    expect(f[0]!.fillStyle).toBe(MIDNIGHT.Background);
    // one Cards box per row, each a 24 px rounded rect
    const boxes = cardLayout({ kind: 'top5', n: 5 });
    const rounds = ops.filter((o) => o.op === 'roundRect' && o.args[4] === 24);
    expect(rounds.map((o) => [o.args[1], o.args[3]])).toEqual(expect.arrayContaining(boxes.map((b) => [b.y, b.h])));
    const cards = f.filter((o) => o.op === 'fill' && o.fillStyle === MIDNIGHT.Cards);
    expect(cards).toHaveLength(5);
  });

  it('a badge fill is ratingColor(rating, cf) and its label colour labelColorOn(fill, colors)', () => {
    for (const colors of [MIDNIGHT, THEMES.Sakura!]) {
      const lightCf = colors === MIDNIGHT ? cf : cfSetFor('Sakura');
      const { ctx, ops } = fakeCtx();
      drawShareCard(ctx, input({ rows: [row(1, { rating: 8.25 })], colors, cf: lightCf }));
      const fill = ratingColor(8.25, lightCf);
      expect(fills(ops).some((o) => o.fillStyle === fill)).toBe(true);
      const label = ops.find((o) => o.op === 'fillText' && o.args[0] === '8.25')!;
      expect(label.fillStyle).toBe(labelColorOn(fill, colors));
      expect(label.font).toMatch(/^700 40px Inter/);
    }
  });

  it('a null cover draws a Panels tile and the title\'s first letter', () => {
    const { ctx, ops } = fakeCtx();
    drawShareCard(ctx, input({ rows: [row(1, { title: 'frieren', cover: null }), row(2, { title: '  ', cover: null })] }));
    expect(fills(ops).filter((o) => o.fillStyle === MIDNIGHT.Panels)).toHaveLength(2);
    expect(texts(ops)).toContain('F');
    expect(ops.some((o) => o.op === 'drawImage')).toBe(false);
  });

  it('three rows draw three rows (no empty slots)', () => {
    const { ctx, ops } = fakeCtx();
    drawShareCard(ctx, input({ rows: [1, 2, 3].map((r) => row(r)) }));
    expect(fills(ops).filter((o) => o.op === 'fill' && o.fillStyle === MIDNIGHT.Cards)).toHaveLength(3);
    const t = texts(ops);
    expect(t).not.toContain('4');
    expect(t).not.toContain('5');
  });

  it('an empty creator draws no creator line and a long title is cut with "…"', () => {
    const { ctx, ops } = fakeCtx();
    const long = 'A'.repeat(200);
    drawShareCard(ctx, input({ rows: [row(1, { title: long, creator: '' }), row(2, { title: long, creator: '' })] }));
    const t = texts(ops);
    expect(t).not.toContain('');
    const cut = t.filter((s) => s.startsWith('AAA'));
    expect(cut.length).toBeGreaterThanOrEqual(2);
    for (const s of cut) {
      expect(s.endsWith('…')).toBe(true);
      expect(s.length * 20).toBeLessThan(CARD_W - 2 * 72);
    }
  });

  it('top5 layout is poster, row, row, compact, compact', () => {
    const boxes = cardLayout({ kind: 'top5', n: 5 });
    expect(boxes.map((b) => b.style)).toEqual(['poster', 'row', 'row', 'compact', 'compact']);
    expect(boxes.slice(1).map((b) => b.h)).toEqual([170, 170, 110, 110]);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBe(boxes[i - 1]!.y + boxes[i - 1]!.h + 16);
    expect(boxes.at(-1)!.y + boxes.at(-1)!.h).toBeLessThanOrEqual(CARD_H - 72 - 60);
    expect(cardLayout({ kind: 'top5', n: 2 }).map((b) => b.style)).toEqual(['poster', 'row']);
  });

  it('the poster draws its cover twice (backdrop with filter blur, then sharp) under a Background scrim at globalAlpha 0.75', () => {
    const { ctx, ops } = fakeCtx();
    drawShareCard(ctx, input({ rows: [row(1, { cover })] }));
    const draws = ops.map((o, i) => ({ ...o, i })).filter((o) => o.op === 'drawImage');
    expect(draws).toHaveLength(2);
    expect(draws.every((d) => d.args[0] === cover)).toBe(true);
    expect(draws[0]!.filter).toMatch(/blur\(\d+px\)/);
    expect(draws[1]!.filter).toBe('none');
    const scrim = ops.findIndex((o, i) => i > draws[0]!.i && i < draws[1]!.i && (o.op === 'fillRect' || o.op === 'fill')
      && o.fillStyle === MIDNIGHT.Background && o.globalAlpha === 0.75);
    expect(scrim).toBeGreaterThan(-1);
    // the backdrop is clipped to the poster box
    expect(ops.slice(0, draws[0]!.i).some((o) => o.op === 'clip')).toBe(true);
    // the sharp cover is 260 wide or less at 2:3, inside the poster box
    const [x, y, w, h] = (draws[1]!.args as number[]).slice(-4); // destination rect (the source may be cropped)
    const box = cardLayout({ kind: 'top5', n: 1 })[0]!;
    expect(w! / h!).toBeCloseTo(2 / 3, 2);
    expect(w).toBeLessThanOrEqual(260);
    expect(y).toBeGreaterThanOrEqual(box.y);
    expect(y! + h!).toBeLessThanOrEqual(box.y + box.h);
    expect(x).toBeGreaterThanOrEqual(72);
  });

  it('the poster\'s text over its backdrop uses Bright text and Text, never Muted text', () => {
    const { ctx, ops } = fakeCtx();
    drawShareCard(ctx, input({ rows: [row(1, { cover })] }));
    expect(ops.find((o) => o.op === 'fillText' && o.args[0] === 'Title 1')!.fillStyle).toBe(MIDNIGHT['Bright text']);
    expect(ops.find((o) => o.op === 'fillText' && o.args[0] === 'Studio 1')!.fillStyle).toBe(MIDNIGHT.Text);
  });

  it('without ctx.filter the backdrop is drawn from a 24 px canvas scaled up', () => {
    const small = fakeCtx();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(small.ctx as unknown as CanvasRenderingContext2D);
    const { ctx, ops } = fakeCtx({ filter: false });
    drawShareCard(ctx, input({ rows: [row(1, { cover })] }));
    expect(spy).toHaveBeenCalledWith('2d');
    const draws = ops.filter((o) => o.op === 'drawImage');
    expect(draws).toHaveLength(2);
    const tiny = draws[0]!.args[0] as HTMLCanvasElement;
    expect(tiny).toBeInstanceOf(HTMLCanvasElement);
    expect(Math.max(tiny.width, tiny.height)).toBe(24);
    expect(small.ops.filter((o) => o.op === 'drawImage')[0]!.args[0]).toBe(cover);
    expect(draws[1]!.args[0]).toBe(cover);
  });

  it('rank discs 1/2/3 fill #f2c14e/#c9cfd9/#e0925a with the numeral in #1b1b25; rank 4 has no disc', () => {
    const { ctx, ops } = fakeCtx();
    drawShareCard(ctx, input());
    MEDALS.forEach((medal, i) => {
      const disc = ops.findIndex((o) => o.op === 'fill' && o.fillStyle === medal);
      expect(disc, `disc ${i + 1}`).toBeGreaterThan(-1);
      const numeral = ops.slice(disc).find((o) => o.op === 'fillText')!;
      expect(numeral.args[0]).toBe(String(i + 1));
      expect(numeral.fillStyle).toBe(MEDAL_INK);
      expect(numeral.font).toMatch(/^800 36px Inter/);
    });
    expect(fills(ops).filter((o) => (MEDALS as readonly string[]).includes(o.fillStyle))).toHaveLength(3);
    const four = ops.find((o) => o.op === 'fillText' && o.args[0] === '4')!;
    expect(four.fillStyle).toBe(MIDNIGHT['Muted text']);
  });

  it('a "My #1s" card with 7 rows fits (cardLayout) and every row has a gold disc and its list name', () => {
    const boxes = cardLayout({ kind: 'ones', n: 7 });
    expect(boxes).toHaveLength(7);
    expect(boxes.every((b) => b.style === 'row' && b.h <= 170)).toBe(true);
    expect(boxes.at(-1)!.y + boxes.at(-1)!.h).toBeLessThanOrEqual(CARD_H - 72 - 60);
    expect(cardLayout({ kind: 'ones', n: 2 }).map((b) => b.h)).toEqual([170, 170]);

    const lists = ['Anime', 'Movies', 'TV Shows', 'Albums', 'Songs', 'Games', 'Books'];
    const { ctx, ops } = fakeCtx();
    drawShareCard(ctx, input({ kind: 'ones', heading: 'My #1s', rows: lists.map((l) => row(1, { listLabel: l, title: `${l} best` })) }));
    expect(fills(ops).filter((o) => o.fillStyle === MEDALS[0])).toHaveLength(7);
    for (const l of lists) {
      const label = ops.find((o) => o.op === 'fillText' && o.args[0] === l)!;
      expect(label.fillStyle).toBe(MIDNIGHT['Muted text']);
      expect(label.font).toMatch(/^700 28px Inter/);
    }
    expect(texts(ops).filter((t) => t === '1')).toHaveLength(7);
    expect(ops.some((o) => o.op === 'drawImage')).toBe(false); // no poster, no covers given
  });

  it('contrast(MEDAL_INK, each medal) ≥ 4.5', () => {
    expect(MEDALS).toEqual(['#f2c14e', '#c9cfd9', '#e0925a']);
    expect(MEDAL_INK).toBe('#1b1b25');
    for (const m of MEDALS) expect(contrast(MEDAL_INK, m)).toBeGreaterThanOrEqual(4.5);
  });

  it('no fillText call uses a font other than Inter', () => {
    const { ctx, ops } = fakeCtx();
    drawShareCard(ctx, input({ kind: 'ones', heading: 'My #1s', rows: [row(1, { listLabel: 'Anime', cover })] }));
    drawShareCard(ctx, input({ rows: [1, 2, 3, 4, 5].map((r) => row(r, { cover: r % 2 ? cover : null })) }));
    const fonts = ops.filter((o) => o.op === 'fillText').map((o) => o.font);
    expect(fonts.length).toBeGreaterThan(10);
    for (const f of fonts) expect(f).toMatch(/^\d{3} \d+px Inter$/);
  });

  // Text roles on the card's own surfaces read at 4.5:1 in every built-in theme (Review Focus 2: light themes).
  it.each(Object.keys(THEMES))('%s: the card\'s text roles read ≥ 4.5:1 on Background and Cards', (name) => {
    const t: ThemeColors = THEMES[name]!;
    for (const role of ['Bright text', 'Text', 'Muted text']) {
      for (const surface of ['Background', 'Cards']) {
        expect(contrast(t[role]!, t[surface]!), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
