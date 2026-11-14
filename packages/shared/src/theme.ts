import type { Status } from './types';

export type ThemeColors = Record<string, string>;

const ROLES = ['Background', 'Alternate rows', 'Header row', 'Cards', 'Panels', 'Text', 'Bright text',
  'Muted text', 'Grid lines', 'Highlight'] as const;

function theme(hexes: string): ThemeColors {
  const v = hexes.split(' ');
  return Object.fromEntries(ROLES.map((r, i) => [r, v[i]!]));
}

export const THEMES: Record<string, ThemeColors> = {
  Midnight: { 'Background': '#1b1b25', 'Alternate rows': '#1f1f2c', 'Header row': '#13131c', 'Cards': '#232339', 'Panels': '#2a2a3b',
              'Text': '#e6e6ed', 'Bright text': '#ffffff', 'Muted text': '#a6a6bb', 'Grid lines': '#2e2e3e', 'Highlight': '#ffd166' },
  Ember: theme('#1c1917 #211d1a #14110f #28221e #312a25 #ede6e1 #ffffff #b3a69c #3a322c #ff9f43'),
  Twilight: theme('#1a1726 #1f1b2e #12101c #262140 #2e2850 #e8e4f4 #ffffff #aaa3c4 #332d4d #c4a7ff'),
  Crimson: theme('#161214 #1b1618 #0f0c0d #231b1e #2c2226 #ece4e6 #ffffff #b0a2a6 #352a2e #ff5c6c'),
  'OLED Black': theme('#000000 #0a0a0a #000000 #121212 #1a1a1a #e8e8e8 #ffffff #a0a0a0 #222222 #ffd166'),
  Ocean:    { 'Background': '#0f1c2b', 'Alternate rows': '#132235', 'Header row': '#0a1420', 'Cards': '#16283d', 'Panels': '#1c3049',
              'Text': '#e3eef8', 'Bright text': '#ffffff', 'Muted text': '#93a9bf', 'Grid lines': '#24384f', 'Highlight': '#5fd4ff' },
  Forest:   { 'Background': '#141d17', 'Alternate rows': '#18241c', 'Header row': '#0e1510', 'Cards': '#1c2b21', 'Panels': '#223327',
              'Text': '#e4efe6', 'Bright text': '#ffffff', 'Muted text': '#9bb3a1', 'Grid lines': '#2a3d30', 'Highlight': '#c8e06b' },
  Light:    { 'Background': '#ffffff', 'Alternate rows': '#f4f5f8', 'Header row': '#e6e8ef', 'Cards': '#f7f7fb', 'Panels': '#e9e9f2',
              'Text': '#2a2b33', 'Bright text': '#111216', 'Muted text': '#6b6e7b', 'Grid lines': '#d9dbe3', 'Highlight': '#b7791f' },
  // Muted text darkened from the script's #8d6b78 (4.42:1) so it passes AA (4.5:1) on this Background.
  Sakura:   { 'Background': '#fff7f9', 'Alternate rows': '#fdeef2', 'Header row': '#f8dde5', 'Cards': '#fff0f4', 'Panels': '#f6e1e8',
              'Text': '#3a2730', 'Bright text': '#2a1a22', 'Muted text': '#8b6a77', 'Grid lines': '#efd3dc', 'Highlight': '#d6457a' },
  Matcha: theme('#fbfaf3 #f3f2e8 #e7ead8 #f6f6ec #e8ecd9 #2a2e24 #14170f #6a705c #dde2cc #4f7a28'),
  Arctic: theme('#f7f9fc #eef2f7 #e1e7f0 #f4f7fb #e4eaf3 #26303d #0f1620 #5f6b7a #d5dde8 #2563c9'),
  Sand: theme('#fbf7f0 #f4eee3 #ebe2d2 #f8f2e8 #ece3d3 #3a3026 #1f1810 #77695a #e2d7c4 #8a5a2b'),
};

export interface CfSet {
  low: string; mid: string; high: string;
  done: string; active: string; hold: string; dropped: string; dup: string;
}

export const CF_SETS: Record<string, CfSet> = {
  Midnight: { low: '#6b2a35', mid: '#6b5a22', high: '#1f6b45', done: '#1f3d2c', active: '#1e3350', hold: '#4a3f1c', dropped: '#4a2026', dup: '#5a1f2a' },
  Light:    { low: '#f4c7c3', mid: '#fce8b2', high: '#b7e1cd', done: '#d9f2e3', active: '#dbe8fb', hold: '#fbefcf', dropped: '#f9d9dc', dup: '#f6c9cf' },
  Ocean:    { low: '#5e2b3a', mid: '#5c5426', high: '#1d5e55', done: '#173a34', active: '#173556', hold: '#3f3a1c', dropped: '#45202b', dup: '#4f1f2c' },
  Forest:   { low: '#5e2c2c', mid: '#5f5720', high: '#2f6a3a', done: '#1f3d26', active: '#1d3445', hold: '#47401c', dropped: '#472224', dup: '#562126' },
  Sakura:   { low: '#f6c6cf', mid: '#fbe6bf', high: '#cfe8d2', done: '#e2f3e5', active: '#e3ebfa', hold: '#fbf0d6', dropped: '#f9dbe1', dup: '#f5c2cf' },
};

const LIGHT_NEW = new Set(['Matcha', 'Arctic', 'Sand']);

/** The highlight colors for a theme; new dark themes share Midnight's, new light themes share Light's. */
export function cfSetFor(themeName: string): CfSet {
  return CF_SETS[themeName] ?? (LIGHT_NEW.has(themeName) ? CF_SETS.Light! : CF_SETS.Midnight!);
}

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 1-10 rating -> color, interpolated linearly in RGB between low (1), mid (6) and high (10). */
export function ratingColor(r: number, cf: CfSet): string {
  const v = Math.min(10, Math.max(1, r));
  const [from, to, t] = v <= 6 ? [cf.low, cf.mid, (v - 1) / 5] : [cf.mid, cf.high, (v - 6) / 4];
  const a = channels(from);
  const b = channels(to);
  return '#' + a.map((x, i) => Math.round(x + (b[i]! - x) * t).toString(16).padStart(2, '0')).join('');
}

/** Row fill for a status. The script has no status-text rules, so this is the spec's mapping. */
export function statusColor(s: Status, cf: CfSet): string | null {
  switch (s) {
    case 'Completed': return cf.done;
    case 'Watching / In Progress':
    case 'Rewatching': return cf.active;
    case 'On Hold': return cf.hold;
    case 'Dropped': return cf.dropped;
    default: return null;
  }
}
