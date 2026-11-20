import { describe, expect, it } from 'vitest';
import { ageText, listTime, mmss, previewOf, quoteText, sentAt, shortQuote, snippetOfMessage } from './format';
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
  it('a note on a rec is kept (older rows without a title still read "a title")', () => {
    const c = makeSummary({ last: { kind: 'rec', text: 'watch it', senderId: REN_U.id, deleted: false, createdAt: at } });
    expect(previewOf(c, ME.id)).toBe('Recommended a title: watch it');
  });
  it('a rec preview names the title', () => {
    const c = makeSummary({ last: { kind: 'rec', text: '', recTitle: 'Frieren', senderId: ME.id, deleted: false, createdAt: at } });
    expect(previewOf(c, ME.id)).toBe('You: Recommended Frieren');
    const withNote = makeSummary({ last: { kind: 'rec', text: 'watch it', recTitle: 'Frieren', senderId: ME.id, deleted: false, createdAt: at } });
    expect(previewOf(withNote, ME.id)).toBe('You: Recommended Frieren: watch it');
  });
  it('no messages', () => {
    expect(previewOf(makeSummary(), ME.id)).toBe('No messages yet');
  });
});

describe('reply snippets', () => {
  it('one line, shortened, with a word for recs and pictures', () => {
    expect(snippetOfMessage({ kind: 'text', text: 'a\n  b', rec: null })).toBe('a b');
    expect(Array.from(snippetOfMessage({ kind: 'text', text: 'x'.repeat(200), rec: null }))).toHaveLength(80);
    expect(snippetOfMessage({ kind: 'image', text: '', rec: null })).toBe('📷 Photo');
    expect(quoteText({ id: 'a', senderId: 'u', senderName: 'Ren', kind: 'rec', snippet: 'Frieren', deleted: false })).toBe('Recommended Frieren');
    expect(quoteText({ id: 'a', senderId: '', senderName: '', kind: 'text', snippet: '', deleted: true })).toBe('Original message deleted');
  });
});

describe('shortQuote (a reply\'s quote)', () => {
  it('keeps short text whole, punctuation included', () => {
    expect(shortQuote('want to watch Frieren tonight?')).toBe('want to watch Frieren tonight?');
  });
  it('cuts at about 40 characters, on a word, with an ellipsis', () => {
    const q = shortQuote('supercalifragilistic expialidocious words keep going here and there');
    expect(q.endsWith('…')).toBe(true);
    expect(Array.from(q).length).toBeLessThanOrEqual(41);
    expect(q).not.toMatch(/\s…$/);
  });
  it('keeps at most 8 words', () => {
    expect(shortQuote('a b c d e f g h i j')).toBe('a b c d e f g h…');
  });
  it('photos, voice memos and recommendations get words', () => {
    const base = { id: 'x', senderId: 'u', senderName: 'Ren', snippet: '', deleted: false };
    expect(quoteText({ ...base, kind: 'image' })).toBe('📷 Photo');
    expect(quoteText({ ...base, kind: 'voice' })).toBe('🎤 Voice memo');
    expect(quoteText({ ...base, kind: 'rec', snippet: 'Frieren' })).toBe('Recommended Frieren');
  });
});

describe('sentAt and mmss', () => {
  it('"Today at", "Yesterday at", else the date; the year only when it is not this one', () => {
    const now = new Date(2026, 10, 20, 23, 55);
    expect(sentAt(new Date(2026, 10, 20, 23, 49).toISOString(), now)).toMatch(/^Today at 11:49\sPM$/);
    expect(sentAt(new Date(2026, 10, 19, 9, 5).toISOString(), now)).toMatch(/^Yesterday at 9:05\sAM$/);
    expect(sentAt(new Date(2026, 10, 18, 15, 2).toISOString(), now)).toMatch(/^Nov 18 at 3:02\sPM$/);
    expect(sentAt(new Date(2025, 0, 3, 8, 0).toISOString(), now)).toMatch(/^Jan 3, 2025 at 8:00\sAM$/);
  });
  it('mmss', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(7_900)).toBe('0:07');
    expect(mmss(119_000)).toBe('1:59');
  });
});
