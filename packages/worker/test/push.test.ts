import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { notify } from '../src/push/send';
import { DEFAULT_USER_SETTINGS } from '@media-tracker/shared';

// Phase 6b (P1-P7). A dan, B ren, C rex; A and B are friends.
const A = 'a@example.com';
const B = 'b@example.com';
const C = 'c@example.com';

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

let vapid: Partial<Env>;
const makeVapid = async (): Promise<Partial<Env>> => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { VAPID_PUBLIC_KEY: b64url(pub), VAPID_PRIVATE_KEY: JSON.stringify(jwk), VAPID_SUBJECT: 'mailto:dan@example.com' };
};
/** A real-looking browser subscription: a P-256 public key and a 16-byte auth secret. */
const makeSub = async (host = 'push.test', id = crypto.randomUUID()) => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return {
    endpoint: `https://${host}/send/${id}`,
    keys: { p256dh: b64url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) },
  };
};

/** Requests with a collecting ExecutionContext; `settle()` awaits everything queued with waitUntil. */
let pending: Promise<unknown>[] = [];
const settle = async () => {
  for (let i = 0; i < 5 && pending.length; i++) {
    const batch = pending;
    pending = [];
    await Promise.all(batch);
  }
};
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const run = (email: string, path: string, method = 'GET', body?: unknown, over: Partial<Env> = {}) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ...over, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
    ctx,
  );
const as = (email: string, path: string, method = 'GET', body?: unknown) => run(email, path, method, body, vapid);
const json = async <T = any>(res: Response) => (await res.json()) as T;
const uid = async (email: string) => (await json<{ id: string }>(await as(email, '/api/me'))).id;

let pushed: string[]; // endpoints the Worker posted to, in order
let status: (url: string) => number;
const realFetch = globalThis.fetch;
const subscribe = async (email: string, sub?: Awaited<ReturnType<typeof makeSub>>) => {
  const s = sub ?? (await makeSub());
  expect((await as(email, '/api/push/subscribe', 'POST', s)).status).toBe(204);
  return s;
};
const rows = (userId: string) => env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ?').bind(userId).all<{ endpoint: string }>().then((r) => r.results.map((x) => x.endpoint));

let a: string, b: string, c: string;
beforeEach(async () => {
  vapid = await makeVapid();
  pushed = [];
  pending = [];
  status = () => 201;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://push.test/')) return realFetch(input, init);
    pushed.push(url);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toMatch(/^vapid /i);
    return new Response(null, { status: status(url) });
  }) as typeof fetch;
  for (const [email, name] of [[A, 'dan'], [B, 'ren'], [C, 'rex']] as const) {
    expect((await as(email, '/api/me/username', 'PUT', { username: name })).status).toBe(200);
  }
  [a, b, c] = [await uid(A), await uid(B), await uid(C)];
  await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
  await settle();
  expect((await as(B, `/api/friends/${a}/accept`, 'POST')).status).toBe(204);
  await settle();
  await env.DB.exec('DELETE FROM push_subscriptions');
  pushed = [];
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await env.DB.exec('DELETE FROM users');
  await env.DB.exec('DELETE FROM push_throttle');
});

describe('/api/push routes (P1, P2)', () => {
  it('key: served when set up, 503 not_configured without keys', async () => {
    const ok = await as(A, '/api/push/key');
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ key: vapid.VAPID_PUBLIC_KEY });
    const none = await run(A, '/api/push/key', 'GET', undefined, {});
    expect(none.status).toBe(503);
    expect(await json(none)).toEqual({ error: 'not_configured' });
    expect((await run(A, '/api/push/key', 'GET', undefined, { ...vapid, VAPID_SUBJECT: '' })).status).toBe(503);
  });

  it('subscribe stores a device, upserts by endpoint (moves it to the new user), and unsubscribe removes only your own', async () => {
    const s = await subscribe(A);
    await subscribe(A, s);
    expect(await rows(a)).toEqual([s.endpoint]);
    await subscribe(B, s);
    expect(await rows(a)).toEqual([]);
    expect(await rows(b)).toEqual([s.endpoint]);
    expect((await as(A, '/api/push/unsubscribe', 'POST', { endpoint: s.endpoint })).status).toBe(204);
    expect(await rows(b)).toEqual([s.endpoint]);
    expect((await as(B, '/api/push/unsubscribe', 'POST', { endpoint: s.endpoint })).status).toBe(204);
    expect(await rows(b)).toEqual([]);
  });

  it('subscribe validates the body; refuses an 11th device and a missing setup', async () => {
    const good = await makeSub();
    for (const bad of [
      null, {}, { endpoint: 'http://push.test/x', keys: good.keys }, { endpoint: 'nope', keys: good.keys }, { endpoint: good.endpoint },
      { endpoint: good.endpoint, keys: { p256dh: good.keys.p256dh } }, { endpoint: good.endpoint, keys: { p256dh: 'short', auth: good.keys.auth } },
      { endpoint: good.endpoint, keys: { p256dh: good.keys.p256dh, auth: 'a b c d e f g h i j k l m n' } },
    ]) {
      expect((await as(A, '/api/push/subscribe', 'POST', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await as(A, '/api/push/unsubscribe', 'POST', {})).status).toBe(400);
    for (let i = 0; i < 10; i++) await subscribe(A);
    expect((await as(A, '/api/push/subscribe', 'POST', await makeSub())).status).toBe(409);
    const existing = (await rows(a))[0]!;
    expect((await as(A, '/api/push/subscribe', 'POST', { endpoint: existing, keys: good.keys })).status).toBe(204);
    expect((await run(B, '/api/push/subscribe', 'POST', good, {})).status).toBe(503);
  });
});

describe('notify (P1, P3, P4)', () => {
  it('sends to every device of the user and cleans up 404/410; other failures are ignored and keep the device', async () => {
    const [s1, s2, s3, s4] = [await subscribe(A), await subscribe(A), await subscribe(A), await subscribe(A)] as const;
    status = (url) => (url === s2.endpoint ? 410 : url === s3.endpoint ? 404 : url === s4.endpoint ? 500 : 201);
    notify({ ...env, ...vapid } as Env, ctx, a, 'messages', { title: 't', body: 'b', tag: 'x', url: '/' });
    await settle();
    expect(pushed.sort()).toEqual([s1.endpoint, s2.endpoint, s3.endpoint, s4.endpoint].sort());
    expect((await rows(a)).sort()).toEqual([s1.endpoint, s4.endpoint].sort());
    const ok = await env.DB.prepare('SELECT last_ok_at FROM push_subscriptions WHERE endpoint = ?').bind(s1.endpoint).first<{ last_ok_at: string | null }>();
    expect(ok!.last_ok_at).not.toBeNull();
  });

  it('a network error on one device does not stop the others or throw', async () => {
    const s1 = await subscribe(A);
    const s2 = await subscribe(A);
    const before = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      (typeof input === 'string' && input === s1.endpoint ? Promise.reject(new Error('offline')) : before(input, init))) as typeof fetch;
    notify({ ...env, ...vapid } as Env, ctx, a, 'messages', { title: 't', body: 'b', tag: 'x', url: '/' });
    await settle();
    expect(pushed).toEqual([s2.endpoint]);
    expect(await rows(a)).toHaveLength(2);
  });

  it('is a no-op without VAPID keys: no queries, no requests', async () => {
    await subscribe(A);
    const spy = vi.spyOn(env.DB, 'prepare');
    for (const missing of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const) {
      notify({ ...env, ...vapid, [missing]: undefined } as Env, ctx, a, 'messages', { title: 't', body: 'b', tag: 'x', url: '/' });
    }
    await settle();
    expect(pushed).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('respects the per-type switch in settings (default all on) and ignores unknown or bad notify values', async () => {
    expect(DEFAULT_USER_SETTINGS.notify).toEqual({ messages: true, friendRequests: true, comments: true, reactions: true, signups: true });
    const me0 = await json(await as(A, '/api/me'));
    expect(me0.settings.notify).toEqual(DEFAULT_USER_SETTINGS.notify);
    await subscribe(A);
    const put = (notifyBody: unknown) => as(A, '/api/me/settings', 'PUT', { settings: { notify: notifyBody } });
    expect((await put({ messages: false, bogus: 1 })).status).toBe(200);
    expect((await put({ comments: 'no' })).status).toBe(400);
    expect((await put('x')).status).toBe(400);
    const saved = (await json(await as(A, '/api/me'))).settings.notify;
    expect(saved).toEqual({ ...DEFAULT_USER_SETTINGS.notify, messages: false });
    const send = (type: 'messages' | 'comments') => notify({ ...env, ...vapid } as Env, ctx, a, type, { title: 't', body: 'b', tag: 'x', url: '/' });
    send('messages');
    await settle();
    expect(pushed).toEqual([]);
    send('comments');
    await settle();
    expect(pushed).toHaveLength(1);
  });
});

describe('events call notify for the right user (P3)', () => {
  const conv = async (email: string, other: string) => (await json<{ id: string }>(await as(email, '/api/conversations', 'POST', { userIds: [other] }))).id;
  /** Which user ids received a push, by the endpoint each registered. */
  const sinks = async () => {
    const out: Record<string, string> = {};
    for (const [name, email] of [['a', A], ['b', B], ['c', C]] as const) out[name] = (await subscribe(email)).endpoint;
    return out;
  };
  const got = (e: Record<string, string>) => Object.entries(e).filter(([, url]) => pushed.includes(url)).map(([k]) => k).sort();
  const reset = () => { pushed = []; };

  it('a new message goes to the other members, not the sender', async () => {
    const id = await conv(A, b);
    const e = await sinks();
    reset();
    expect((await as(A, `/api/conversations/${id}/messages`, 'POST', { text: 'are we watching Frieren tonight?' })).status).toBe(201);
    await settle();
    expect(got(e)).toEqual(['b']);
  });

  it('a group message goes to every other member', async () => {
    await as(C, '/api/friends/requests', 'POST', { username: 'dan' });
    await settle();
    await as(A, `/api/friends/${c}/accept`, 'POST');
    const g = (await json<{ id: string }>(await as(A, '/api/conversations', 'POST', { userIds: [b, c], name: 'Movie night' }))).id;
    const e = await sinks();
    reset();
    await as(B, `/api/conversations/${g}/messages`, 'POST', { text: 'hi' });
    await settle();
    expect(got(e)).toEqual(['a', 'c']);
  });

  it('a friend request goes to the receiver; accepting goes to the requester', async () => {
    const e = await sinks();
    reset();
    expect((await as(C, '/api/friends/requests', 'POST', { username: 'dan' })).status).toBe(200);
    await settle();
    expect(got(e)).toEqual(['a']);
    reset();
    expect((await as(A, `/api/friends/${c}/accept`, 'POST')).status).toBe(204);
    await settle();
    expect(got(e)).toEqual(['c']);
  });

  it('a comment on your post goes to the post owner, not to yourself', async () => {
    const entry = await post(A);
    const e = await sinks();
    reset();
    expect((await as(B, '/api/comments', 'POST', { activityId: entry, body: 'nice' })).status).toBe(201);
    await settle();
    expect(got(e)).toEqual(['a']);
    reset();
    await as(A, '/api/comments', 'POST', { activityId: entry, body: 'thanks' });
    await settle();
    expect(got(e)).toEqual([]);
  });

  it('a reaction goes to the post owner, at most once per post per 10 minutes, and removing one sends nothing', async () => {
    const entry = await post(A);
    const e = await sinks();
    reset();
    await as(B, '/api/reactions', 'POST', { activityId: entry, emoji: '🔥' });
    await settle();
    expect(got(e)).toEqual(['a']);
    reset();
    await as(B, '/api/reactions', 'POST', { activityId: entry, emoji: '❤️' });
    await settle();
    expect(pushed).toEqual([]);
    await env.DB.prepare('UPDATE push_throttle SET sent_at = ?').bind(new Date(Date.now() - 11 * 60_000).toISOString()).run();
    await as(B, '/api/reactions', 'POST', { activityId: entry, emoji: '😂' });
    await settle();
    expect(got(e)).toEqual(['a']);
    reset();
    await env.DB.exec('DELETE FROM push_throttle');
    await as(B, '/api/reactions', 'POST', { activityId: entry, emoji: '😂' }); // toggles off
    await settle();
    expect(pushed).toEqual([]);
  });

  it('a sign-up waiting goes to the admin only', async () => {
    const e = await sinks();
    reset();
    const res = await app.fetch(
      new Request('https://app.test/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'newbie', password: 'correct horse battery' }) }),
      { ...env, ...vapid, ADMIN_EMAIL: A } as Env,
      ctx,
    );
    expect(res.status).toBe(201);
    await settle();
    expect(got(e)).toEqual(['a']);
  });

  /** An activity post id of `email` (a rated entry makes one). */
  async function post(email: string): Promise<string> {
    const res = await as(email, '/api/entries', 'POST', { category: 'movies', title: 'Heat', rating: 9 });
    expect(res.status).toBe(201);
    const act = await env.DB.prepare(`SELECT a.id FROM activity a JOIN entries e ON e.id = a.entry_id WHERE e.user_id = ? AND a.post_id IS NULL ORDER BY a.rowid DESC`).bind(await uid(email)).first<{ id: string }>();
    expect(act).not.toBeNull();
    return act!.id;
  }
});
