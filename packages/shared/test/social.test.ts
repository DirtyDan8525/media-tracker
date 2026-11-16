import { describe, expect, it } from 'vitest';
import { isReaction, REACTIONS } from '../src/social';

describe('isReaction', () => {
  it('keeps the six quick emojis', () => {
    expect(REACTIONS).toHaveLength(6);
    for (const e of REACTIONS) expect(isReaction(e)).toBe(true);
  });

  it.each(['❤️', '👍🏽', '🏳️‍🌈', '🇯🇵', '👨‍👩‍👧‍👦', '😀', '🎉'])('accepts one emoji %s', (e) => {
    expect(isReaction(e)).toBe(true);
  });

  it.each(['a', '1', '#', '', ' ', '❤️❤️', '👍🏽👍🏽', '🇯🇵🇯🇵', 'a❤️', '❤️ ', 'hello', 'x'.repeat(40), '👨‍👩‍👧‍👦'.repeat(5)])(
    'rejects %j',
    (e) => {
      expect(isReaction(e)).toBe(false);
    },
  );

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 1, {}, ['❤️']]) expect(isReaction(v)).toBe(false);
  });
});
