/**
 * Shared test helper (A4): every non-GET /api request from a browser carries `Origin`. The tests
 * call `app.fetch` directly, so this wraps it once (installed from setup.ts) to add the request's own
 * origin when a test did not set one. A test that needs a request WITHOUT an Origin uses `rawFetch`.
 */
import { app } from '../src/index';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const rawFetch: typeof app.fetch = app.fetch;

export function withSameOrigin(req: Request): Request {
  if (SAFE.has(req.method) || req.headers.has('Origin')) return req;
  const headers = new Headers(req.headers);
  headers.set('Origin', new URL(req.url).origin);
  return new Request(req, { headers });
}

let installed = false;
export function installOriginHelper(): void {
  if (installed) return;
  installed = true;
  app.fetch = ((req: Request, ...rest: Parameters<typeof app.fetch> extends [unknown, ...infer R] ? R : never) =>
    rawFetch(withSameOrigin(req), ...rest)) as typeof app.fetch;
}
