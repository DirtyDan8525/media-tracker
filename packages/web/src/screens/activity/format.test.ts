import { describe, expect, it } from 'vitest';
import { dayLabel, timeAgo } from './format';

// Local-time dates, so the tests hold in any time zone.
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);
const iso = (d: Date) => d.toISOString();
const clock = (d: Date) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);

describe('dayLabel', () => {
  const now = at(2026, 11, 15, 0, 30);
  it('local midnight is the boundary between Yesterday and Today', () => {
    expect(dayLabel(iso(at(2026, 11, 15, 0, 0)), now)).toBe('Today');
    expect(dayLabel(iso(at(2026, 11, 14, 23, 59, 59)), now)).toBe('Yesterday');
    expect(dayLabel(iso(at(2026, 11, 14, 0, 0)), now)).toBe('Yesterday');
    expect(dayLabel(iso(at(2026, 11, 13, 23, 59)), now)).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(at(2026, 11, 13, 23, 59)),
    );
  });
  it('Yesterday crosses a month end', () => {
    expect(dayLabel(iso(at(2026, 10, 31, 22)), at(2026, 11, 1, 9))).toBe('Yesterday');
  });
});

describe('timeAgo', () => {
  const now = at(2026, 11, 15, 12, 0, 0);
  const ago = (ms: number) => iso(new Date(now.getTime() - ms));
  it('under a minute is "just now" (also for a clock a little ahead)', () => {
    expect(timeAgo(ago(0), now)).toBe('just now');
    expect(timeAgo(ago(59_000), now)).toBe('just now');
    expect(timeAgo(ago(-5_000), now)).toBe('just now');
  });
  it('minutes up to 59, then hours', () => {
    expect(timeAgo(ago(60_000), now)).toBe('1 min ago');
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(timeAgo(ago(59 * 60_000 + 59_000), now)).toBe('59 min ago');
    expect(timeAgo(ago(60 * 60_000), now)).toBe('1 h ago');
    expect(timeAgo(ago(3 * 3_600_000 + 20 * 60_000), now)).toBe('3 h ago');
    expect(timeAgo(ago(23 * 3_600_000 + 59 * 60_000), now)).toBe('23 h ago');
  });
  it('a day or more back is the time of day', () => {
    const d = new Date(now.getTime() - 24 * 3_600_000);
    expect(timeAgo(iso(d), now)).toBe(clock(d));
  });
});
