import { DEFAULT_USER_SETTINGS, THEMES } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { applyTheme, barTextColor, CF_VARS, contrast, contrastWarnings, onHighlightColor, ROLE_VARS } from './theme';

const css = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('applyTheme', () => {
  it('Midnight sets --bg to #1b1b25', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Midnight' });
    expect(css('--bg')).toBe('#1b1b25');
  });

  it('sets all 10 role variables for Midnight', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Midnight' });
    expect(Object.keys(ROLE_VARS)).toHaveLength(10);
    expect({
      '--bg': css('--bg'), '--alt-row': css('--alt-row'), '--header-row': css('--header-row'), '--card': css('--card'),
      '--panel': css('--panel'), '--text': css('--text'), '--bright-text': css('--bright-text'),
      '--muted-text': css('--muted-text'), '--grid-line': css('--grid-line'), '--highlight': css('--highlight'),
    }).toEqual({
      '--bg': '#1b1b25', '--alt-row': '#1f1f2c', '--header-row': '#13131c', '--card': '#232339', '--panel': '#2a2a3b',
      '--text': '#e6e6ed', '--bright-text': '#ffffff', '--muted-text': '#a6a6bb', '--grid-line': '#2e2e3e', '--highlight': '#ffd166',
    });
  });

  it('sets all 10 role variables for Sakura, including the darkened muted text and Highlight', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Sakura' });
    for (const [role, v] of Object.entries(ROLE_VARS)) expect(css(v), v).toBe(THEMES.Sakura![role]);
    expect(css('--muted-text')).toBe('#876773');
    expect(css('--highlight')).toBe('#ce2e68');
    expect(css('--bg')).toBe('#fff7f9');
  });

  it('sets the CF set for the theme', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Sakura' });
    expect(css(CF_VARS.high)).toBe('#cfe8d2');
    expect(css('--cf-low')).toBe('#f6c6cf');
    expect(css('--cf-dup')).toBe('#f5c2cf');
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Ember' });
    expect(css('--cf-high')).toBe('#1f6b45'); // new dark themes share Midnight's
  });

  it('uses settings.colors for Custom, falling back to Midnight per missing role', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Custom', colors: { Background: '#101010', Highlight: '#ff00aa' } });
    expect(css('--bg')).toBe('#101010');
    expect(css('--highlight')).toBe('#ff00aa');
    expect(css('--text')).toBe('#e6e6ed');
  });

  it('falls back to Midnight for an unknown theme name', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Nope' });
    expect(css('--bg')).toBe('#1b1b25');
  });

  it('picks readable text for highlight buttons', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Midnight' });
    expect(css('--on-highlight')).toBe('#13131c');
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Light' });
    expect(css('--on-highlight')).toBe('#ffffff'); // Light's darkened Highlight (P15) reads best with its white Background
  });

  it.each(Object.keys(THEMES))('%s: the primary-button label reaches 4.5:1 on Highlight', (theme) => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme });
    expect(contrast(css('--on-highlight'), css('--highlight'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(css('--on-highlight-small'), css('--highlight'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the black/white fallback for small labels on a Custom Highlight none of the roles can read on', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Custom', colors: { Background: '#7a7a7a', 'Header row': '#808080', 'Bright text': '#858585', Highlight: '#ffffff' } });
    expect(css('--on-highlight-small')).toBe('#000000');
  });
});

describe('contrastWarnings', () => {
  it('is empty for every built-in theme', () => {
    for (const [name, colors] of Object.entries(THEMES)) expect(contrastWarnings(colors), name).toEqual([]);
  });

  it('flags a muted text that is hard to read on Background', () => {
    const w = contrastWarnings({ ...THEMES.Midnight!, 'Muted text': '#55556a' });
    expect(w).toContainEqual(expect.objectContaining({ role: 'Muted text', surface: 'Background' }));
    expect(w.every((x) => x.ratio < 4.5)).toBe(true);
  });

  it('lists roles in order, Background before Cards, with the ratio', () => {
    const w = contrastWarnings({ ...THEMES.Midnight!, Text: '#333333' });
    expect(w.map((x) => [x.role, x.surface])).toEqual([['Text', 'Background'], ['Text', 'Cards']]);
    expect(w[0]!.ratio).toBeCloseTo(contrast('#333333', '#1b1b25'), 5);
  });
});

describe('contrastWarnings: button text on Highlight', () => {
  const grey = { ...THEMES.Midnight!, Highlight: '#808080', 'Header row': '#8a8a8a', Background: '#777777', 'Bright text': '#858585' };

  it('flags a Custom Highlight that no label colour reads on, with the ratio of the best one', () => {
    const w = contrastWarnings(grey).filter((x) => x.surface === 'Highlight');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ role: 'Button text', surface: 'Highlight' });
    expect(w[0]!.ratio).toBeCloseTo(Math.max(...['#8a8a8a', '#777777', '#858585'].map((c) => contrast(c, '#808080'))), 5);
    expect(contrast(onHighlightColor(grey), '#808080')).toBeLessThan(4.5);
  });

  it('says nothing when one of the label colours reads at 4.5:1', () => {
    expect(contrastWarnings({ ...THEMES.Midnight!, Highlight: '#ff9f43' }).filter((x) => x.surface === 'Highlight')).toEqual([]);
  });
});

describe('barTextColor (B22)', () => {
  it('picks whichever of Bright text and Text has more contrast on Header row', () => {
    const colors = { ...THEMES.Midnight!, 'Header row': '#f0f0f0', 'Bright text': '#ffffff', Text: '#222222' };
    expect(barTextColor(colors)).toBe('#222222');
    expect(barTextColor({ ...colors, 'Header row': '#101010' })).toBe('#ffffff');
  });

  it('applyTheme sets --bar-text from it', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Sakura' });
    expect(css('--bar-text')).toBe(barTextColor(THEMES.Sakura!));
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Custom', colors: { 'Header row': '#fafafa', Text: '#111111', 'Bright text': '#ffffff' } });
    expect(css('--bar-text')).toBe('#111111');
  });
});

describe('applyTheme with the admin accent (AD5)', () => {
  it('sets Highlight and a readable label colour when the accent reads at AA on the theme', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Midnight' }, document.documentElement, '#ff9f43');
    expect(document.documentElement.style.getPropertyValue('--highlight')).toBe('#ff9f43');
    expect(contrast(document.documentElement.style.getPropertyValue('--on-highlight'), '#ff9f43')).toBeGreaterThanOrEqual(4.5);
  });

  it('ignores an accent that does not reach 4.5:1 on Background and Cards', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Midnight' }, document.documentElement, '#9b671a');
    expect(document.documentElement.style.getPropertyValue('--highlight')).toBe('#ffd166');
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Sakura' }, document.documentElement, '#5fd4ff');
    expect(document.documentElement.style.getPropertyValue('--highlight')).toBe('#ce2e68');
  });

  it("leaves a Custom theme's own Highlight alone", () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Custom', colors: { Highlight: '#ff00aa' } }, document.documentElement, '#ff9f43');
    expect(document.documentElement.style.getPropertyValue('--highlight')).toBe('#ff00aa');
  });
});
