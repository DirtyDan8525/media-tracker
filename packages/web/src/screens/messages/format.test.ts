import { describe, expect, it } from 'vitest';
import { ageText, listTime, previewOf } from './format';
import { fitWithin } from './resizeImage';
import { makeSummary, ME, REN_U } from '../../test/messagesBackend';

describe('fitWithin', () => {
  it('scales the longest side to 1600 and keeps the aspect', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 800, height: 1600 });
  });
  it('never enlarges', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it('never makes a side 0', () => {
    expect(fitWithin(100000, 10).height).toBe(1);
  });
});

describe('listTime and ageText', () => {
  const now = new Date(2026, 10, 17, 15, 0);
  it('today is a clock, yesterday a word, older a date', () => {
    expect(listTime(new Date(2026, 10, 17, 14, 20).toISOString(), now)).toMatch(/14.20|2.20/);
    expect(listTime(new Date(2026, 10, 16, 9, 0).toISOString(), now)).toBe('Yesterday');
    expect(listTime(new Date(2026, 9, 1, 9, 0).toISOString(), now)).toMatch(/1/);
  });
  it('age', () => {
    expect(ageText(new Date(now.getTime() - 30_000).toISOString(), now)).toBe('just now');
    expect(ageText(new Date(now.getTime() - 5 * 3_600_000).toISOString(), now)).toBe('5 h');
    expect(ageText(new Date(now.getTime() - 2 * 86_400_000).toISOString(), now)).toBe('2 d');
    expect(ageText(new Date(now.getTime() - 9 * 86_400_000).toISOString(), now)).toBe('1 w');
  });
});

describe('previewOf', () => {
  const at = '2026-11-17T10:00:00Z';
  it('a note on a rec is kept', () => {
    const c = makeSummary({ last: { kind: 'rec', text: 'watch it', senderId: REN_U.id, deleted: false, createdAt: at } });
    expect(previewOf(c, ME.id)).toBe('Recommended a title: watch it');
  });
  it('no messages', () => {
    expect(previewOf(makeSummary(), ME.id)).toBe('No messages yet');
  });
});
