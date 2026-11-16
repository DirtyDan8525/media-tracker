import type { Me } from '../api/types';
import { makeMe, mockFetch, type Call, type Handler, type MockResponse } from './mockApi';

/**
 * A Worker stand-in with a session: /api/me answers 401 until a sign-in, sign-up or reset
 * route "sets the cookie" (the handler returns `me`). `signedIn` starts as given.
 */
export function authBackend(opts: { me?: Me; signedIn?: boolean; me401?: MockResponse; extra?: Record<string, Handler | MockResponse> } = {}) {
  const state = { me: opts.me ?? makeMe(), signedIn: opts.signedIn ?? false, me401: opts.me401 ?? { status: 401, body: { error: 'unauthorized' } } };
  const calls: Call[] = mockFetch({
    'GET /api/me': () => (state.signedIn ? { body: state.me } : state.me401),
    'GET /api/entries': () => (state.signedIn ? { body: [] } : state.me401),
    'POST /api/auth/login': () => { state.signedIn = true; return { body: state.me }; },
    'POST /api/auth/signup': () => { state.signedIn = true; return { status: 201, body: state.me }; },
    'POST /api/auth/logout': () => { state.signedIn = false; return { status: 204 }; },
    ...opts.extra,
  });
  return { state, calls };
}
