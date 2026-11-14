import { describe, expect, it } from 'vitest';
import { CF_SETS, STATUSES, THEMES, cfSetFor, ratingColor, statusColor } from '../src/index';

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('ratingColor', () => {
  it('hits the stops exactly', () => {
    expect(ratingColor(1, CF_SETS.Midnight!)).toBe('#6b2a35');
    expect(ratingColor(6, CF_SETS.Midnight!)).toBe('#6b5a22');
    expect(ratingColor(10, CF_SETS.Midnight!)).toBe('#1f6b45');
  });
  it('interpolates between mid and high', () => {
    const c = ratingColor(8, CF_SETS.Midnight!);
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(c).toBe('#456334');
  });
  it('clamps out-of-range ratings', () => {
    expect(ratingColor(0, CF_SETS.Midnight!)).toBe('#6b2a35');
    expect(ratingColor(11, CF_SETS.Midnight!)).toBe('#1f6b45');
  });
});

describe('themes', () => {
  it('has 12 themes with 10 roles each', () => {
    expect(Object.keys(THEMES)).toEqual(['Midnight', 'Ember', 'Twilight', 'Crimson', 'OLED Black', 'Ocean',
      'Forest', 'Light', 'Sakura', 'Matcha', 'Arctic', 'Sand']);
    for (const t of Object.values(THEMES)) expect(Object.keys(t)).toHaveLength(10);
  });
  it('uses exact values for Midnight and a few new themes', () => {
    expect(THEMES.Midnight!['Background']).toBe('#1b1b25');
    expect(THEMES.Ember!['Highlight']).toBe('#ff9f43');
    expect(THEMES.Sand!['Grid lines']).toBe('#e2d7c4');
  });
  it.each(Object.keys(THEMES))('%s text colors pass AA against Background and Cards', (name) => {
    const t = THEMES[name]!;
    for (const role of ['Text', 'Bright text', 'Muted text']) {
      for (const surface of ['Background', 'Cards']) {
        expect(contrast(t[role]!, t[surface]!), `${name} ${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('darkens Sakura Muted text so it passes on Cards (Ruling P10)', () => {
    expect(THEMES.Sakura!['Muted text']).toBe('#876773');
  });
  it('darkens Light and Sakura Highlight so it passes on Background and Cards (Ruling P15)', () => {
    expect(THEMES.Light!['Highlight']).toBe('#9b671a');
    expect(THEMES.Sakura!['Highlight']).toBe('#ce2e68');
  });
  // Every other theme's Highlight already passed, so all 12 are checked (P15 changes only Light and Sakura).
  it.each(Object.keys(THEMES))('%s Highlight passes AA against Background and Cards', (name) => {
    const t = THEMES[name]!;
    for (const surface of ['Background', 'Cards']) {
      expect(contrast(t['Highlight']!, t[surface]!), `${name} Highlight on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('picks a CF set per theme', () => {
    expect(cfSetFor('Midnight')).toBe(CF_SETS.Midnight);
    expect(cfSetFor('Ember')).toBe(CF_SETS.Midnight);
    expect(cfSetFor('OLED Black')).toBe(CF_SETS.Midnight);
    expect(cfSetFor('Matcha')).toBe(CF_SETS.Light);
    expect(cfSetFor('Sand')).toBe(CF_SETS.Light);
    expect(cfSetFor('Ocean')).toBe(CF_SETS.Ocean);
  });
});

describe('statusColor', () => {
  it('maps statuses to CF roles', () => {
    const cf = CF_SETS.Midnight!;
    expect(STATUSES).toHaveLength(6);
    expect(statusColor('Completed', cf)).toBe(cf.done);
    expect(statusColor('Watching / In Progress', cf)).toBe(cf.active);
    expect(statusColor('Rewatching', cf)).toBe(cf.active);
    expect(statusColor('On Hold', cf)).toBe(cf.hold);
    expect(statusColor('Dropped', cf)).toBe(cf.dropped);
    expect(statusColor('Plan to watch', cf)).toBeNull();
  });
});
