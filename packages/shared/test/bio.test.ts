import { describe, expect, it } from 'vitest';
import { BIO_MAX, bioLength, validateBio } from '../src/bio';

describe('validateBio', () => {
  it('trims, keeps line breaks and emoji', () => {
    expect(validateBio('  hello 🍜\nsecond line  ')).toEqual({ ok: true, bio: 'hello 🍜\nsecond line' });
  });
  it('normalizes CRLF to LF', () => {
    expect(validateBio('a\r\nb')).toEqual({ ok: true, bio: 'a\nb' });
  });
  it('empty or blank clears the bio (null)', () => {
    expect(validateBio('')).toEqual({ ok: true, bio: null });
    expect(validateBio('  \n ')).toEqual({ ok: true, bio: null });
  });
  it('allows exactly 150 characters, counting an emoji as one', () => {
    expect(validateBio('a'.repeat(BIO_MAX)).ok).toBe(true);
    expect(validateBio('🍜'.repeat(BIO_MAX)).ok).toBe(true);
    expect(validateBio('a'.repeat(BIO_MAX + 1))).toEqual({ ok: false, error: 'invalid' });
    expect(bioLength('🍜a')).toBe(2);
  });
  it('allows 4 lines, refuses 5', () => {
    expect(validateBio('1\n2\n3\n4').ok).toBe(true);
    expect(validateBio('1\n2\n3\n4\n5')).toEqual({ ok: false, error: 'invalid' });
  });
  it('refuses links', () => {
    for (const s of ['see https://example.com', 'http://x.y', 'www.example.org', 'my site: example.com', 'insta.gg/me', 'a@b.io', 'ftp://x']) {
      expect(validateBio(s), s).toEqual({ ok: false, error: 'no_links' });
    }
  });
  it('does not mistake ordinary text for a link', () => {
    for (const s of ['Rewatching Frieren... again', 'v2.0 is out', 'ok.Fine', '3.5/10 on average', 'Dr. Stone fan']) {
      expect(validateBio(s).ok, s).toBe(true);
    }
  });
  it('refuses non-strings', () => {
    for (const v of [undefined, null, 5, {}, ['a']]) expect(validateBio(v)).toEqual({ ok: false, error: 'invalid' });
  });
});
