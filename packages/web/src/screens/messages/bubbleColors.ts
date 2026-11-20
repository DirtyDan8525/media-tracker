import type { ThemeColors } from '@media-tracker/shared';
import { useMemo } from 'react';
import { useThemeColors } from '../../design/ThemeContext';
import { contrast, onHighlightColor } from '../../design/theme';

const MIN = 4.5;

const toRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, t: number): string => {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex(x.map((v, i) => v + (y[i]! - v) * t));
};

/**
 * My bubbles in a chat (Dan, 2026-11-19): the theme's Highlight as the fill and its on-Highlight colour as the text, so the chat follows the
 * theme. The text must reach 4.5:1 on the fill: the on-Highlight colour first, then black or white; if none does (a Custom theme with a
 * mid-tone Highlight), the fill is mixed towards black or white, whichever reads better, until one does. Every built-in theme passes with
 * its plain Highlight (see bubbleColors.test.ts), so this fallback only ever touches Custom themes.
 */
export function bubbleMineColors(colors: ThemeColors): { bg: string; text: string } {
  const hl = colors.Highlight ?? '#ffd166';
  const texts = [onHighlightColor(colors), '#000000', '#ffffff'];
  const ok = texts.find((t) => contrast(t, hl) >= MIN);
  if (ok) return { bg: hl, text: ok };
  // Darker or lighter accent: the direction whose best text has more contrast.
  const darker = (t: number) => mix(hl, '#000000', t);
  const lighter = (t: number) => mix(hl, '#ffffff', t);
  const best = (bg: string) => texts.reduce((b, t) => (contrast(t, bg) > contrast(b, bg) ? t : b));
  const useDark = contrast('#ffffff', darker(0.5)) >= contrast('#000000', lighter(0.5));
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const bg = useDark ? darker(t) : lighter(t);
    const text = best(bg);
    if (contrast(text, bg) >= MIN) return { bg, text };
  }
  return { bg: useDark ? '#000000' : '#ffffff', text: useDark ? '#ffffff' : '#000000' };
}

/**
 * The bubble colours for the active theme. The Highlight is read from the page's live `--highlight` (so an admin accent, which replaces
 * the Highlight on the page, is followed too), falling back to the theme's own.
 */
export function useBubbleMineColors(): { bg: string; text: string } {
  const colors = useThemeColors();
  const live = typeof document === 'undefined' ? '' : document.documentElement.style.getPropertyValue('--highlight').trim();
  return useMemo(() => bubbleMineColors(/^#[0-9a-f]{6}$/i.test(live) ? { ...colors, Highlight: live } : colors), [colors, live]);
}
