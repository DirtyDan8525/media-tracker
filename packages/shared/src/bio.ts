/** Profile bio rules (Phase 5, item 17): plain text, line breaks and emoji allowed, no links. */
export const BIO_MAX = 150;
export const BIO_MAX_LINES = 4;

/** Length in characters as a person counts them (an emoji is one, not two UTF-16 units). */
export const bioLength = (s: string): number => [...s].length;

const TLDS = 'com|net|org|io|co|me|gg|tv|app|dev|xyz|ly|gl|be|link|info|biz|us|uk|ca|de|fr|jp|ru|cn|in|au|nl|se|to|cc|fm|ws|so|sh|ai|page|site|online|store|tech|club|live|fun|wtf';
const LINK_RE = new RegExp(
  `[a-z][a-z0-9+.-]*://|\\bwww\\.|\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b|\\b[a-z0-9._-]+@[a-z0-9-]+\\.[a-z]{2,}`,
  'i',
);

/** True when the text holds something that would be a link (a scheme, "www.", or a domain name). */
export const hasLink = (s: string): boolean => LINK_RE.test(s);

export type BioResult = { ok: true; bio: string | null } | { ok: false; error: 'invalid' | 'no_links' };

/** Trims, keeps line breaks (CRLF -> LF), at most 150 characters and 4 lines; empty clears (null); a link is `no_links`. */
export function validateBio(raw: unknown): BioResult {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid' };
  const bio = raw.replace(/\r\n?/g, '\n').trim();
  if (bio === '') return { ok: true, bio: null };
  if (bioLength(bio) > BIO_MAX || bio.split('\n').length > BIO_MAX_LINES) return { ok: false, error: 'invalid' };
  if (hasLink(bio)) return { ok: false, error: 'no_links' };
  return { ok: true, bio };
}
