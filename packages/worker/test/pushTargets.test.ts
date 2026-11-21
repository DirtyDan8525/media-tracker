import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import type { PushPayload } from '../src/push/send';

// Comments and reactions are the title's (migration 0025): their pushes are tagged and throttled per title, and open
// the title, whether they were left on an Activity post or on the title page. `notify` is wrapped to see the payloads.
const sent = vi.hoisted(() => [] as { to: string; type: string; payload: PushPayload }[]);
vi.mock('../src/push/send', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/push/send')>();
  return {
    ...real,
    pushConfigured: () => true,
    notify: (_env: unknown, _ctx: unknown, to: string, type: string, payload: PushPayload) => void sent.push({ to, type, payload }),
  };
});

// The setup file has loaded the app's modules already: start from a fresh module graph so the mock is the one used.
let app: typeof import('../src/index').app;
beforeAll(async () => {
  vi.resetModules();
  ({ app } = await import('../src/index'));
});

const now = '2026-11-20T12:00:00.000Z';
let pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const settle = async () => { while (pending.length) { const b = pending; pending = []; await Promise.all(b); } };
const as = (email: string, path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json', Origin: 'https://app.test' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
    ctx,
  );

beforeEach(async () => {
  sent.length = 0;
  pending = [];
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, username, display_name, settings_json, created_at) VALUES ('uA', 'andre@x.com', 'andre', 'Andre', '{}', ?1), ('uD', 'dan@x.com', 'dan', 'Dan', '{}', ?1)").bind(now),
    env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES ('uA', 'uD', 'accepted', 'uA', ?)").bind(now),
    env.DB.prepare("INSERT INTO entries (id, user_id, category, title, is_private, rating, created_at, updated_at) VALUES ('song', 'uA', 'songs', 'Song', 0, 8, ?1, ?1)").bind(now),
    env.DB.prepare("INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES ('p1', 'uA', 'song', 'rated', '{}', ?1, ?1), ('p2', 'uA', 'song', 're-rated', '{}', ?1, ?1)").bind(now),
  ]);
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users; DELETE FROM push_throttle;');
});

describe('comment and reaction pushes go by title', () => {
  it('a comment on a post and one on the title page: both tagged comment-<entryId>, both open /entry/<entryId>', async () => {
    expect((await as('dan@x.com', '/api/comments', 'POST', { activityId: 'p1', body: 'great' })).status).toBe(201);
    expect((await as('dan@x.com', '/api/comments', 'POST', { entryId: 'song', body: 'again' })).status).toBe(201);
    await settle();
    expect(sent.map((s) => [s.to, s.type, s.payload.tag, s.payload.url])).toEqual([
      ['uA', 'comments', 'comment-song', '/entry/song'],
      ['uA', 'comments', 'comment-song', '/entry/song'],
    ]);
  });

  it('reactions: one push per title per 10 minutes, across its posts and its page', async () => {
    await as('dan@x.com', '/api/reactions', 'POST', { activityId: 'p1', emoji: '🔥' });
    await settle();
    expect(sent.map((s) => [s.to, s.type, s.payload.tag, s.payload.url])).toEqual([['uA', 'reactions', 'reaction-song', '/entry/song']]);
    // Another post about the same title, then the title page: the same 10-minute window.
    await as('dan@x.com', '/api/reactions', 'POST', { activityId: 'p2', emoji: '❤️' });
    await as('dan@x.com', '/api/reactions', 'POST', { entryId: 'song', emoji: '😂' });
    await settle();
    expect(sent).toHaveLength(1);
    const keys = (await env.DB.prepare('SELECT key FROM push_throttle').all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual(['reaction:song']);
    await env.DB.prepare('UPDATE push_throttle SET sent_at = ?').bind(new Date(Date.now() - 11 * 60_000).toISOString()).run();
    await as('dan@x.com', '/api/reactions', 'POST', { entryId: 'song', emoji: '👍' });
    await settle();
    expect(sent.map((s) => s.payload.tag)).toEqual(['reaction-song', 'reaction-song']);
  });
});
