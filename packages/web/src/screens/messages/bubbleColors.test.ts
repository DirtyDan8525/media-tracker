import { THEMES, type ThemeColors } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { contrast } from '../../design/theme';
import { bubbleMineColors } from './bubbleColors';

describe('my bubble colours', () => {
  it.each(Object.keys(THEMES))('%s: the text on my bubble reaches 4.5:1, and the fill is the theme Highlight', (name) => {
    const colors = THEMES[name]!;
    const { bg, text } = bubbleMineColors(colors);
    expect(contrast(text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(bg).toBe(colors.Highlight);
  });

  it('a Custom Highlight too dim for any text is mixed darker or lighter until it reads', () => {
    for (const hl of ['#808080', '#777777', '#8a8a8a', '#ff00aa', '#00aa55']) {
      const colors: ThemeColors = { ...THEMES.Midnight!, Highlight: hl, 'Header row': hl, Background: hl, 'Bright text': hl };
      const { bg, text } = bubbleMineColors(colors);
      expect(contrast(text, bg), hl).toBeGreaterThanOrEqual(4.5);
    }
  });
});
