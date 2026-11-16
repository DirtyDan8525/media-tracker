/** Invite codes: 12 chars [a-z0-9], one per user (users.invite_code, unique). */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newInviteCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Reads users.invite_code, creating it when NULL; retries once on a unique clash. Returns the code. */
export async function ensureInviteCode(db: D1Database, userId: string): Promise<string> {
  const row = await db.prepare('SELECT invite_code FROM users WHERE id = ?').bind(userId).first<{ invite_code: string | null }>();
  if (row?.invite_code) return row.invite_code;
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = newInviteCode();
    try {
      await db.prepare('UPDATE users SET invite_code = ? WHERE id = ? AND invite_code IS NULL').bind(code, userId).run();
    } catch (e) {
      if (attempt === 0 && /unique/i.test(String(e))) continue;
      throw e;
    }
    const again = await db.prepare('SELECT invite_code FROM users WHERE id = ?').bind(userId).first<{ invite_code: string | null }>();
    if (again?.invite_code) return again.invite_code;
  }
  throw new Error('could not create invite code');
}
