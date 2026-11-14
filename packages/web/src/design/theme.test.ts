import { DEFAULT_USER_SETTINGS, THEMES } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { applyTheme, CF_VARS, ROLE_VARS } from './theme';

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

  it('sets all 10 role variables for Sakura, including the darkened muted text', () => {
    applyTheme({ ...DEFAULT_USER_SETTINGS, theme: 'Sakura' });
    for (const [role, v] of Object.entries(ROLE_VARS)) expect(css(v), v).toBe(THEMES.Sakura![role]);
    expect(css('--muted-text')).toBe('#8b6a77');
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
    expect(css('--on-highlight')).toBe('#111216');
  });
});
