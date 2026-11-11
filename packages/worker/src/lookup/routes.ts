// POST /api/lookup and POST /api/lookup/details (mounted on the authed api router).
import { Hono } from 'hono';
import type { Category, Details, SourceId } from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import type { Env } from '../env';
import { CATEGORIES } from '../api/entryValidation';
import { getCached, putCached } from './cache';
import { lookupChain } from './chain';
import { envSecrets, redactSecrets } from './http';
import { SOURCE_IDS, SOURCES, type LookupDeps } from './sources/index';

export const lookup = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const MAX_TERM = 500;
const MAX_SOURCE_ID = 200;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return isPlainObject(body) ? body : null;
  } catch {
    return null;
  }
}

// An optional string field: absent/undefined gives '', otherwise it must be a string within `max`.
const optString = (v: unknown, max: number): string | null =>
  v === undefined ? '' : typeof v === 'string' && v.length <= max ? v : null;

function depsFor(env: Env, log: string[]): LookupDeps {
  // Late-bound so tests can spy on globalThis.fetch.
  return { fetch: (input, init) => globalThis.fetch(input, init), env, log };
}

lookup.post('/', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json(invalid, 400);
  const { category, term, debug } = body;
  if (typeof category !== 'string' || !(CATEGORIES as string[]).includes(category)) return c.json(invalid, 400);
  if (typeof term !== 'string' || term.trim() === '' || term.length > MAX_TERM) return c.json(invalid, 400);
  const typedTitle = optString(body.typedTitle, MAX_TERM);
  const hint = optString(body.hint, MAX_TERM);
  if (typedTitle === null || hint === null) return c.json(invalid, 400);

  const log: string[] = [];
  const cat = category as Category;
  const info = await lookupChain(cat, { term, typedTitle, hint, category: cat }, depsFor(c.env, log));
  if (debug === true && c.var.user.isAdmin) {
    const secrets = envSecrets(c.env);
    return c.json({ info, log: log.map((l) => redactSecrets(l, secrets)) });
  }
  return c.json({ info });
});

lookup.post('/details', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json(invalid, 400);
  const { source, sourceId } = body;
  if (typeof source !== 'string' || !(SOURCE_IDS as string[]).includes(source)) return c.json(invalid, 400);
  if (typeof sourceId !== 'string' || sourceId === '' || sourceId.length > MAX_SOURCE_ID) return c.json(invalid, 400);

  const id = source as SourceId;
  const detailsFn = SOURCES[id]?.details;
  if (!detailsFn) return c.json({ details: null });

  const key = `details:${sourceId}`;
  const cached = await getCached<Details>(c.env.DB, id, key);
  if (cached) return c.json({ details: cached });

  let details: Details | null = null;
  try {
    details = await detailsFn(sourceId, depsFor(c.env, []));
  } catch (err) {
    console.warn(`details ${id} failed`, redactSecrets(String(err instanceof Error ? err.message : err), envSecrets(c.env)));
  }
  if (details) await putCached(c.env.DB, id, key, details);
  return c.json({ details });
});
