/**
 * The Cloudflare Access reusable policy behind the app's lock (plan S1). Approving an email adds an
 * `include` rule; removing access drops it. Each call is GET then (maybe) a full-replace PUT, 8 s timeout each.
 */
import type { Env } from '../env';

export class CloudflareError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** CF_API_TOKEN, CF_ACCOUNT_ID or ACCESS_POLICY_ID is missing. */
export class NotConfigured extends Error {}

/** Refusing to drop the only include rule (the policy would let nobody in, or be rejected). */
export class LastRule extends Error {}

type Rule = Record<string, unknown>;
type Policy = Record<string, unknown> & { include?: Rule[] };

const DROP_ON_PUT = ['id', 'created_at', 'updated_at', 'app_count', 'reusable'];
const TIMEOUT_MS = 8000;

const emailOf = (rule: Rule): string | null => {
  const e = (rule as { email?: { email?: unknown } }).email?.email;
  return typeof e === 'string' ? e.toLowerCase() : null;
};

async function call(env: Env, method: 'GET' | 'PUT', body?: unknown): Promise<Policy> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.ACCESS_POLICY_ID) throw new NotConfigured();
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/policies/${env.ACCESS_POLICY_ID}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new CloudflareError(502, 'Cloudflare did not answer in time');
  }
  let json: { success?: boolean; errors?: { message?: string }[]; result?: Policy } | null = null;
  try {
    json = await res.json();
  } catch {
    // not JSON: handled below
  }
  if (!res.ok || json?.success !== true || !json.result) {
    throw new CloudflareError(502, json?.errors?.[0]?.message || `Cloudflare answered ${res.status}`);
  }
  return json.result;
}

function putBody(policy: Policy, include: Rule[]): Record<string, unknown> {
  const body: Record<string, unknown> = { ...policy, include };
  for (const k of DROP_ON_PUT) delete body[k];
  return body;
}

/** Adds `email` to the policy's include rules unless already there (case-insensitive). 1 GET, 0 or 1 PUT. */
export async function allowEmail(env: Env, email: string): Promise<{ added: boolean }> {
  const wanted = email.trim().toLowerCase();
  const policy = await call(env, 'GET');
  const include = policy.include ?? [];
  if (include.some((r) => emailOf(r) === wanted)) return { added: false };
  await call(env, 'PUT', putBody(policy, [...include, { email: { email: wanted } }]));
  return { added: true };
}

/** Drops the email's include rules (case-insensitive). PUTs only if something was removed; throws LastRule if that would empty `include`. */
export async function removeEmail(env: Env, email: string): Promise<{ removed: boolean }> {
  const target = email.trim().toLowerCase();
  const policy = await call(env, 'GET');
  const include = policy.include ?? [];
  const kept = include.filter((r) => emailOf(r) !== target);
  if (kept.length === include.length) return { removed: false };
  if (kept.length === 0) throw new LastRule();
  await call(env, 'PUT', putBody(policy, kept));
  return { removed: true };
}
