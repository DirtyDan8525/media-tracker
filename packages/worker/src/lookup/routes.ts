// POST /api/lookup and POST /api/lookup/details (mounted on the authed api router).
import { Hono } from 'hono';
import type { Category, Details, LookupInfo, SourceId } from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import type { Env } from '../env';
import { CATEGORIES } from '../api/entryValidation';
import { getCached, putCached } from './cache';
import { lookupChain } from './chain';
import { envSecrets, redactSecrets } from './http';
import { SOURCE_IDS, SOURCES, keysPresent, type LookupDeps } from './sources/index';

export const lookup = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const MAX_TERM = 500;
// Source ids are numbers, slugs or keys like OL123W / tt0811080: no slashes, spaces or query characters.
const SOURCE_ID_RE = /^[\w.:\-]{1,200}$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** True for a Details object with nothing in it (all four fields empty): treated as a miss, never cached. */
export function isEmptyDetails(d: Details | null | undefined): boolean {
  return !d || [d.releaseDate, d.synopsis, d.lengthLabel, d.origin].every((v) => !v);
}

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

/** E2E switch: canned lookups, only ever in dev. */
const fakeLookup = (env: Env) => env.ENVIRONMENT === 'dev' && env.LOOKUP_FAKE === '1';

const titleCase = (s: string) => s.trim().replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

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

  if (fakeLookup(c.env)) {
    const info: LookupInfo = {
      title: titleCase(term),
      trusted: true,
      cover: `${new URL(c.req.url).origin}/icon-192.png`,
      genres: 'Test',
      creator: 'Test Studio',
      source: 'anilist',
      sourceId: '1',
    };
    return c.json({ info });
  }

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
  if (typeof sourceId !== 'string' || !SOURCE_ID_RE.test(sourceId)) return c.json(invalid, 400);

  if (fakeLookup(c.env)) {
    const details: Details = { releaseDate: '2023-09-29', synopsis: 'Test synopsis.', lengthLabel: '24 min', origin: 'TV' };
    return c.json({ details });
  }

  const id = source as SourceId;
  const entry = SOURCES[id];
  const detailsFn = entry?.details;
  // Same key rule as the chain: a source whose key isn't set is never called.
  if (!entry || !detailsFn || !keysPresent(id, entry, c.env)) return c.json({ details: null });

  const key = `details:${sourceId}`;
  const cached = await getCached<Details>(c.env.DB, id, key);
  if (cached) return c.json({ details: cached });

  let details: Details | null = null;
  try {
    details = await detailsFn(sourceId, depsFor(c.env, []));
  } catch (err) {
    console.warn(`details ${id} failed`, redactSecrets(String(err instanceof Error ? err.message : err), envSecrets(c.env)));
  }
  if (isEmptyDetails(details)) details = null;
  if (details) await putCached(c.env.DB, id, key, details);
  return c.json({ details });
});
