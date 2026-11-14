import { describe, expect, it } from 'vitest';
import { formatRating } from '../src/index';

describe('formatRating', () => {
  it.each([
    [10, '10.0'], [0, '0.0'], [9.5, '9.5'], [8, '8.0'], [8.25, '8.25'], [8.1, '8.1'], [7.05, '7.05'],
    [8.333333, '8.33'], [8.999, '9.0'], [8.996, '9.0'], [6.7, '6.7'], [0.5, '0.5'],
  ])('%s -> %s', (n, text) => {
    expect(formatRating(n)).toBe(text);
  });
});
