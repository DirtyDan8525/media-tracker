import { describe, expect, it } from 'vitest';
import { LIST_POLL_MS, listPollMs } from './messages';

describe('listPollMs', () => {
  it('30 s while the list changes, 60 s after 2 minutes unchanged, 120 s after 10', () => {
    expect(listPollMs(0)).toBe(LIST_POLL_MS);
    expect(listPollMs(119_999)).toBe(30_000);
    expect(listPollMs(120_000)).toBe(60_000);
    expect(listPollMs(599_999)).toBe(60_000);
    expect(listPollMs(600_000)).toBe(120_000);
  });
});
