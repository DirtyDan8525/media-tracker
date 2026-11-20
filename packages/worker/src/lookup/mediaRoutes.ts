// GET /api/preview?kind=track|album&title=&artist=[&id=track:123] -> { url: string | null }
// GET /api/trailer?kind=movie|tv|anime&title=&year=[&id=] -> { youtubeId: string | null }
// Both are mounted on the authed api router. Errors and "nothing found" are 200 with null.
import { Hono } from 'hono';
import type { AppEnv } from '../auth/user';
import type { Env } from '../env';
import type { LookupDeps } from './sources/index';
import { previewUrl } from './preview';
import { trailerId } from './trailer';

const invalid = { error: 'invalid' } as const;
const deps = (env: Env): LookupDeps => ({ fetch: (input, init) => globalThis.fetch(input, init), env, log: [] });

export const preview = new Hono<AppEnv>();
preview.get('/', async (c) => {
  const kind = c.req.query('kind');
  const title = c.req.query('title');
  const artist = c.req.query('artist') ?? '';
  const id = c.req.query('id') ?? '';
  if (kind !== 'track' && kind !== 'album') return c.json(invalid, 400);
  if (typeof title !== 'string' || title.trim() === '' || title.length > 300 || artist.length > 300) return c.json(invalid, 400);
  // The entry's own Deezer id ("track:123" / "album:123"): used only when its kind matches.
  const m = /^(track|album):(\d{1,12})$/.exec(id);
  const url = await previewUrl(kind, title.trim(), artist.trim(), m && m[1] === kind ? m[2]! : null, deps(c.env));
  return c.json({ url });
});

export const trailer = new Hono<AppEnv>();
trailer.get('/', async (c) => {
  const kind = c.req.query('kind');
  const title = c.req.query('title');
  const year = c.req.query('year') ?? '';
  const id = c.req.query('id') ?? '';
  if (kind !== 'movie' && kind !== 'tv' && kind !== 'anime') return c.json(invalid, 400);
  if (typeof title !== 'string' || title.trim() === '' || title.length > 300 || !/^(\d{4})?$/.test(year) || !/^(\d{1,9})?$/.test(id)) return c.json(invalid, 400);
  const youtubeId = await trailerId(kind, title.trim(), year, id || null, deps(c.env));
  return c.json({ youtubeId });
});
