export const AVATAR_MAX_BYTES = 65_536;
export const AVATAR_SIZE = 256;
export const AVATAR_TYPES = ['image/webp', 'image/jpeg'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

// Longest base64 text a maximum-size photo can take (4 chars per 3 bytes, padded).
const BASE64_MAX_CHARS = Math.ceil(AVATAR_MAX_BYTES / 3) * 4;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const isWebp = (b: Uint8Array) =>
  b.length >= 12 &&
  b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
  b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50; // WEBP
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * Validates a `{ type, data }` upload body: type is one of AVATAR_TYPES, `data` is strict base64,
 * at most AVATAR_MAX_BYTES once decoded, and the magic bytes match the declared type.
 * Null for anything else.
 */
export function decodeAvatar(body: unknown): { type: AvatarType; bytes: Uint8Array } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { type, data } = body as { type?: unknown; data?: unknown };
  if (typeof type !== 'string' || !(AVATAR_TYPES as readonly string[]).includes(type)) return null;
  if (typeof data !== 'string' || data.length === 0 || data.length > BASE64_MAX_CHARS) return null;
  if (data.length % 4 !== 0 || !BASE64_RE.test(data)) return null;
  let bytes: Uint8Array;
  try {
    const bin = atob(data);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) return null;
  if (type === 'image/webp' ? !isWebp(bytes) : !isJpeg(bytes)) return null;
  return { type: type as AvatarType, bytes };
}
