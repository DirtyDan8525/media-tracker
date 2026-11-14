import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportFileName } from './ExportRow';

describe('exportFileName', () => {
  const tz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/New_York'; }); // UTC-5 in November
  afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });

  it('uses the local date, not the UTC one', () => {
    const lateEvening = new Date(2026, 10, 14, 23, 30); // 14 Nov 23:30 local = 15 Nov 04:30 UTC
    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-11-15'); // the offset really is in effect
    expect(exportFileName(lateEvening)).toBe('media-tracker-export-2026-11-14.json');
  });

  it('pads month and day', () => {
    expect(exportFileName(new Date(2026, 0, 2, 9, 0))).toBe('media-tracker-export-2026-01-02.json');
  });
});
