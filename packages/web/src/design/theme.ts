import { cfSetFor, THEMES, type CfSet, type ThemeColors, type UserSettings } from '@media-tracker/shared';

/**
 * Theme role (as named in the Sheet's Settings tab and `THEMES`) -> CSS variable.
 * One variable per role, nothing derived, so a Custom theme maps straight across.
 */
export const ROLE_VARS = {
  'Background': '--bg',
  'Alternate rows': '--alt-row',
  'Header row': '--header-row',
  'Cards': '--card',
  'Panels': '--panel',
  'Text': '--text',
  'Bright text': '--bright-text',
  'Muted text': '--muted-text',
  'Grid lines': '--grid-line',
  'Highlight': '--highlight',
} as const;

/** CF (conditional-format) set key -> CSS variable. */
export const CF_VARS: Record<keyof CfSet, string> = {
  low: '--cf-low', mid: '--cf-mid', high: '--cf-high',
  done: '--cf-done', active: '--cf-active', hold: '--cf-hold', dropped: '--cf-dropped', dup: '--cf-dup',
};

const MIDNIGHT = THEMES.Midnight!;

/** The 10 role colors for the user's theme; Custom fills missing roles from Midnight. */
export function themeColors(s: Pick<UserSettings, 'theme' | 'colors'>): ThemeColors {
  if (s.theme === 'Custom') return { ...MIDNIGHT, ...s.colors };
  return THEMES[s.theme] ?? MIDNIGHT;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** The CF set for a theme. A Custom theme gets the light set when its Background is light. */
export function cfFor(s: Pick<UserSettings, 'theme' | 'colors'>): CfSet {
  if (s.theme === 'Custom') return cfSetFor(luminance(themeColors(s).Background!) > 0.5 ? 'Light' : 'Midnight');
  return cfSetFor(s.theme);
}

/**
 * Sets the theme's 10 role colors, the CF set and `--on-highlight` (text on Highlight-filled
 * buttons: whichever of Header row / Background / Bright text reads best) on :root.
 */
export function applyTheme(s: Pick<UserSettings, 'theme' | 'colors'>, root: HTMLElement = document.documentElement): void {
  const colors = themeColors(s);
  for (const [role, v] of Object.entries(ROLE_VARS)) root.style.setProperty(v, colors[role] ?? MIDNIGHT[role]!);
  const cf = cfFor(s);
  for (const [k, v] of Object.entries(CF_VARS)) root.style.setProperty(v, cf[k as keyof CfSet]);

  const hl = colors.Highlight!;
  const candidates = [colors['Header row']!, colors.Background!, colors['Bright text']!];
  const onHl = candidates.reduce((best, c) => (contrast(c, hl) > contrast(best, hl) ? c : best));
  root.style.setProperty('--on-highlight', onHl);

  const bgLight = luminance(colors.Background!) > 0.5;
  root.style.colorScheme = bgLight ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.Background!);
}
