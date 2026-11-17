import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { GROUP_MAX, MESSAGE_MAX, type Conversation, type ConversationList, type Message, type MessagePage, type RecSnapshot } from '@media-tracker/shared';
import { spyD1 } from './d1spy';

// Phase 6 (M1-M9). A dan, B ren, C rex are friends of each other; D dax is a stranger to all of them.
const A = 'a@example.com';
const B = 'b@example.com';
const C = 'c@example.com';
const D = 'd@example.com';

const run = (email: string, path: string, init: RequestInit, db?: D1Database, over: Partial<Env> = {}) =>
  app.fetch(new Request(`https://app.test${path}`, init), { ...env, ...(db ? { DB: db } : {}), ...over, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env);
const as = (email: string, path: string, method = 'GET', body?: unknown, db?: D1Database) =>
  run(email, path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, db);
const json = async <T = any>(res: Response) => (await res.json()) as T;
const uid = async (email: string) => (await json<{ id: string }>(await as(email, '/api/me'))).id;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
const upload = (email: string, conv: string, bytes: Uint8Array | ArrayBuffer, type = 'image/png', over: Partial<Env> = {}, db?: D1Database) =>
  run(email, `/api/conversations/${conv}/messages/image`, { method: 'POST', headers: { 'content-type': type }, body: bytes as BodyInit }, db, over);

let a: string, b: string, c: string, d: string;

const befriend = async (from: string, fromName: string, to: string, toName: string) => {
  await as(from, '/api/friends/requests', 'POST', { username: toName });
  expect((await as(to, `/api/friends/${await uid(from)}/accept`, 'POST')).status).toBe(204);
  void fromName;
};
const direct = async (email: string, other: string) => {
  const res = await as(email, '/api/conversations', 'POST', { userIds: [other] });
  expect([200, 201]).toContain(res.status);
  return (await json<Conversation>(res)).id;
};
const group = async (email: string, others: string[], name?: string) => {
  const res = await as(email, '/api/conversations', 'POST', { userIds: others, name });
  expect(res.status).toBe(201);
  return (await json<Conversation>(res)).id;
};
const say = async (email: string, conv: string, text: string) => {
  const res = await as(email, `/api/conversations/${conv}/messages`, 'POST', { text });
  expect(res.status).toBe(201);
  return json<Message>(res);
};
const page = async (email: string, conv: string, qs = '') => json<MessagePage>(await as(email, `/api/conversations/${conv}/messages${qs}`));
const unread = async (email: string) => (await json<{ messages: number }>(await as(email, '/api/activity/unread'))).messages;
const REC: RecSnapshot = { category: 'anime', title: 'Frieren', creator: 'Madhouse', coverUrl: 'https://img.test/f.jpg', rating: 9.5, source: 'anilist', sourceId: '154587' };

beforeEach(async () => {
  for (const [email, name] of [[A, 'dan'], [B, 'ren'], [C, 'rex'], [D, 'dax']] as const) {
    expect((await as(email, '/api/me/username', 'PUT', { username: name })).status).toBe(200);
  }
  [a, b, c, d] = [await uid(A), await uid(B), await uid(C), await uid(D)];
  await befriend(A, 'dan', B, 'ren');
  await befriend(A, 'dan', C, 'rex');
  await befriend(B, 'ren', C, 'rex');
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
  const listed = await env.MEDIA!.list();
  if (listed.objects.length) await env.MEDIA!.delete(listed.objects.map((o) => o.key));
});

describe('creating conversations (M2)', () => {
  it('one friend makes a direct chat; asking again returns the same one (200), from either side', async () => {
    const res = await as(A, '/api/conversations', 'POST', { userIds: [b] });
    expect(res.status).toBe(201);
    const conv = await json<Conversation>(res);
    expect(conv).toMatchObject({ kind: 'direct', name: null, createdBy: a, readOnly: false });
    expect(conv.members.map((m) => m.username).sort()).toEqual(['dan', 'ren']);
    const again = await as(A, '/api/conversations', 'POST', { userIds: [b] });
    expect(again.status).toBe(200);
    expect((await json<Conversation>(again)).id).toBe(conv.id);
    expect(await direct(B, a)).toBe(conv.id);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM conversations').first<{ n: number }>())!.n).toBe(1);
  });

  it('a non-friend, a pending request, an unknown id are 403; yourself, nothing, bad shapes are 400', async () => {
    expect((await as(A, '/api/conversations', 'POST', { userIds: [d] })).status).toBe(403);
    expect(await json(await as(A, '/api/conversations', 'POST', { userIds: [d] }))).toEqual({ error: 'not_friends' });
    await as(A, '/api/friends/requests', 'POST', { username: 'dax' }); // pending only
    expect((await as(A, '/api/conversations', 'POST', { userIds: [d] })).status).toBe(403);
    expect((await as(A, '/api/conversations', 'POST', { userIds: ['nobody'] })).status).toBe(403);
    expect((await as(A, '/api/conversations', 'POST', { userIds: [a] })).status).toBe(400);
    expect((await as(A, '/api/conversations', 'POST', { userIds: [] })).status).toBe(400);
    expect((await as(A, '/api/conversations', 'POST', {})).status).toBe(400);
    expect((await as(A, '/api/conversations', 'POST', { userIds: [b, 5] })).status).toBe(400);
    expect((await as(A, '/api/conversations', 'POST', { userIds: [b, c], name: 'x'.repeat(61) })).status).toBe(400);
    expect((await as(A, '/api/conversations', 'POST', { userIds: [b, d] })).status).toBe(403); // one stranger spoils the group
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM conversations').first<{ n: number }>())!.n).toBe(0);
  });

  it('two or more friends make a group (trimmed name optional); 19 others is the most', async () => {
    const res = await as(A, '/api/conversations', 'POST', { userIds: [b, c, b], name: '  Anime night ' });
    expect(res.status).toBe(201);
    const g = await json<Conversation>(res);
    expect(g).toMatchObject({ kind: 'group', name: 'Anime night', createdBy: a });
    expect(g.members).toHaveLength(3);
    expect((await json<Conversation>(await as(A, '/api/conversations', 'POST', { userIds: [b, c] }))).name).toBeNull();
    const many = Array.from({ length: GROUP_MAX }, (_, i) => `u${i}`);
    expect((await as(A, '/api/conversations', 'POST', { userIds: many })).status).toBe(400);
  });

  it('a removed or pending friend cannot be added or chatted with', async () => {
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(b).run();
    expect((await as(A, '/api/conversations', 'POST', { userIds: [b] })).status).toBe(403);
    expect((await as(A, '/api/conversations', 'POST', { userIds: [b, c] })).status).toBe(403);
  });
});

describe('membership (M3): everyone else gets 404', () => {
  it('a non-member can not read, send, send a picture, rename, add, leave, or open a picture or delete a message', async () => {
    const g = await group(A, [b, c]);
    const m = await say(A, g, 'hi');
    const img = await json<Message>(await upload(A, g, PNG));
    expect(img.kind).toBe('image');
    const hits: [string, string, unknown?][] = [
      ['GET', `/api/conversations/${g}`],
      ['GET', `/api/conversations/${g}/messages`],
      ['POST', `/api/conversations/${g}/messages`, { text: 'x' }],
      ['PATCH', `/api/conversations/${g}`, { name: 'x' }],
      ['POST', `/api/conversations/${g}/members`, { userIds: [d] }],
      ['DELETE', `/api/conversations/${g}/members/me`],
      ['GET', `/api/messages/${img.id}/image`],
      ['DELETE', `/api/messages/${m.id}`],
      ['GET', '/api/conversations/nope'],
    ];
    for (const [method, path, body] of hits) {
      const res = await as(D, path, method, body);
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    expect((await upload(D, g, PNG)).status).toBe(404);
    // still intact
    expect((await page(A, g)).messages).toHaveLength(2);
    expect((await env.MEDIA!.list()).objects).toHaveLength(1);
    expect((await json<ConversationList>(await as(D, '/api/conversations'))).conversations).toEqual([]);
  });

  it('a friend who is not in the chat is a stranger to it too', async () => {
    const dm = await direct(A, b);
    expect((await as(C, `/api/conversations/${dm}`)).status).toBe(404);
    expect((await as(C, `/api/conversations/${dm}/messages`)).status).toBe(404);
  });
});

describe('the list, a chat and groups', () => {
  it('lists chats newest activity first with members, last message and unread', async () => {
    const g = await group(A, [b, c], 'Trio');
    const dm = await direct(A, b);
    await say(B, dm, 'x'.repeat(200));
    await say(A, g, 'hello group');
    const res = await as(B, '/api/conversations');
    const { conversations } = await json<ConversationList>(res);
    expect(conversations.map((x) => x.id)).toEqual([g, dm]);
    expect(conversations[0]).toMatchObject({ kind: 'group', name: 'Trio', unread: true, last: { kind: 'text', text: 'hello group', senderId: a, deleted: false } });
    expect(conversations[0]!.members.map((m) => m.username).sort()).toEqual(['dan', 'ren', 'rex']);
    expect(conversations[1]!.last!.text).toHaveLength(80); // a snippet
    expect(conversations[1]!.unread).toBe(false); // my own last message
    const mine = (await json<ConversationList>(await as(A, '/api/conversations'))).conversations;
    expect(mine.find((x) => x.id === dm)!.unread).toBe(true);
    expect(mine.find((x) => x.id === g)!.unread).toBe(false);
  });

  it('a new group with no messages is listed with last null; rec, image and deleted previews', async () => {
    const g = await group(A, [b, c]);
    expect((await json<ConversationList>(await as(A, '/api/conversations'))).conversations[0]).toMatchObject({ id: g, last: null, unread: false });
    await as(A, `/api/conversations/${g}/messages`, 'POST', { rec: REC, text: 'watch this' });
    expect((await json<ConversationList>(await as(B, '/api/conversations'))).conversations[0]!.last).toMatchObject({ kind: 'rec', text: 'watch this' });
    const img = await json<Message>(await upload(A, g, PNG));
    expect((await json<ConversationList>(await as(B, '/api/conversations'))).conversations[0]!.last).toMatchObject({ kind: 'image', text: '' });
    await as(A, `/api/messages/${img.id}`, 'DELETE');
    expect((await json<ConversationList>(await as(B, '/api/conversations'))).conversations[0]!.last).toMatchObject({ kind: 'image', text: '', deleted: true });
  });

  it('any member renames a group; direct chats can not be renamed; bad names are 400', async () => {
    const g = await group(A, [b, c], 'Old');
    const res = await as(B, `/api/conversations/${g}`, 'PATCH', { name: ' New name ' });
    expect(res.status).toBe(200);
    expect((await json<Conversation>(res)).name).toBe('New name');
    expect((await as(B, `/api/conversations/${g}`, 'PATCH', { name: '' })).status).toBe(400);
    expect((await as(B, `/api/conversations/${g}`, 'PATCH', {})).status).toBe(400);
    expect((await as(B, `/api/conversations/${g}`, 'PATCH', { name: 5 })).status).toBe(400);
    const dm = await direct(A, b);
    expect(await json(await as(A, `/api/conversations/${dm}`, 'PATCH', { name: 'x' }))).toEqual({ error: 'not_group' });
  });

  it('adding members: only your own friends, no duplicates, cap 20, not to a direct chat', async () => {
    const g = await group(A, [b, c]);
    // B is not a friend of dax; A neither
    expect((await as(B, `/api/conversations/${g}/members`, 'POST', { userIds: [d] })).status).toBe(403);
    await befriend(B, 'ren', D, 'dax'); // now D is B's friend, not A's
    const res = await as(B, `/api/conversations/${g}/members`, 'POST', { userIds: [d, b, c] });
    expect(res.status).toBe(200);
    expect((await json<Conversation>(res)).members).toHaveLength(4);
    expect((await as(A, `/api/conversations/${g}`)).status).toBe(200);
    expect((await as(D, `/api/conversations/${g}`)).status).toBe(200);
    expect((await as(B, `/api/conversations/${g}/members`, 'POST', { userIds: [d] })).status).toBe(200); // already in: no-op
    expect((await as(B, `/api/conversations/${g}/members`, 'POST', { userIds: [] })).status).toBe(400);
    const dm = await direct(A, b);
    expect((await as(A, `/api/conversations/${dm}/members`, 'POST', { userIds: [c] })).status).toBe(400);
  });

  it('a group stops at 20 members', async () => {
    const g = await group(A, [b, c]);
    const ts = new Date().toISOString();
    const ids = Array.from({ length: 16 }, (_, i) => `fill${i}`);
    for (const id of ids) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users (id, email, username, settings_json, created_at) VALUES (?1, ?1 || '@x', ?1, '{}', ?2)").bind(id, ts),
        env.DB.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').bind(g, id, ts),
      ]);
    }
    await befriend(A, 'dan', D, 'dax');
    const res = await as(A, `/api/conversations/${g}/members`, 'POST', { userIds: [d] }); // 19 + 1 = 20: fits
    expect(res.status).toBe(200);
    await env.DB.prepare("INSERT INTO users (id, email, username, settings_json, created_at) VALUES ('extra', 'extra@x', 'extra', '{}', ?)").bind(ts).run();
    const [x, y] = a < 'extra' ? [a, 'extra'] : ['extra', a];
    await env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at, accepted_at) VALUES (?, ?, 'accepted', ?, ?, ?)").bind(x, y, a, ts, ts).run();
    const full = await as(A, `/api/conversations/${g}/members`, 'POST', { userIds: ['extra'] });
    expect(full.status).toBe(409);
    expect(await json(full)).toEqual({ error: 'group_full' });
    expect((await json<Conversation>(await as(A, `/api/conversations/${g}`))).members).toHaveLength(20);
  });

  it('leaving: the rest carry on, the last one out deletes the group with its messages and pictures; direct can not be left', async () => {
    const g = await group(A, [b, c]);
    await say(A, g, 'hi');
    await upload(A, g, PNG);
    expect((await as(A, `/api/conversations/${g}/members/me`, 'DELETE')).status).toBe(204);
    expect((await as(A, `/api/conversations/${g}`)).status).toBe(404);
    expect((await as(A, `/api/conversations/${g}/members/me`, 'DELETE')).status).toBe(404);
    expect((await page(B, g)).messages).toHaveLength(2);
    expect((await json<Conversation>(await as(B, `/api/conversations/${g}`))).members.map((m) => m.username).sort()).toEqual(['ren', 'rex']);
    expect((await as(B, `/api/conversations/${g}/members/me`, 'DELETE')).status).toBe(204);
    expect((await env.MEDIA!.list()).objects).toHaveLength(1); // C still in
    expect((await as(C, `/api/conversations/${g}/members/me`, 'DELETE')).status).toBe(204);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM conversations').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>())!.n).toBe(0);
    expect((await env.MEDIA!.list()).objects).toHaveLength(0);
    const dm = await direct(A, b);
    expect(await json(await as(A, `/api/conversations/${dm}/members/me`, 'DELETE'))).toEqual({ error: 'not_group' });
  });

  it('unfriending leaves the group alone but makes the direct chat read-only (reading stays, sending is 403)', async () => {
    const g = await group(A, [b, c]);
    const dm = await direct(A, b);
    await say(A, dm, 'before');
    expect((await as(A, `/api/friends/${b}`, 'DELETE')).status).toBe(204);
    for (const who of [A, B]) {
      const res = await as(who, `/api/conversations/${dm}/messages`, 'POST', { text: 'after' });
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ error: 'read_only' });
      expect((await upload(who, dm, PNG)).status).toBe(403);
      const p = await page(who, dm);
      expect(p.readOnly).toBe(true);
      expect(p.messages.map((m) => m.text)).toEqual(['before']);
      expect((await json<Conversation>(await as(who, `/api/conversations/${dm}`))).readOnly).toBe(true);
    }
    expect((await json<ConversationList>(await as(A, '/api/conversations'))).conversations.find((x) => x.id === dm)!.readOnly).toBe(true);
    // the group still works for both
    await say(A, g, 'still here');
    await say(B, g, 'yes');
    // and the direct chat comes back when they are friends again
    await befriend(A, 'dan', B, 'ren');
    await say(A, dm, 'back');
    expect((await page(A, dm)).readOnly).toBe(false);
  });
});

describe('sending and reading (M3, M5)', () => {
  it('text is trimmed, 1..2000 characters; 201 with the message; the page lists newest first with users', async () => {
    const dm = await direct(A, b);
    const m = await say(A, dm, '  hello  ');
    expect(m).toMatchObject({ conversationId: dm, senderId: a, kind: 'text', text: 'hello', rec: null, image: false, deleted: false });
    await say(B, dm, 'two');
    await say(A, dm, 'x'.repeat(MESSAGE_MAX));
    for (const bad of [{ text: '' }, { text: '   ' }, {}, { text: 5 }, { text: 'x'.repeat(MESSAGE_MAX + 1) }, { rec: 'nope' }, { text: 'a', rec: { ...REC, category: 'nope' } }]) {
      expect([bad, (await as(A, `/api/conversations/${dm}/messages`, 'POST', bad)).status]).toEqual([bad, 400]);
    }
    const p = await page(A, dm);
    expect(p.messages.map((x) => x.text.slice(0, 5))).toEqual(['xxxxx', 'two', 'hello']);
    expect(p.users[a]!.username).toBe('dan');
    expect(p.users[b]!.username).toBe('ren');
    expect(p.next).toBeNull();
  });

  it('pages of 50 with a before cursor; no message is repeated or skipped, even in one millisecond', async () => {
    const dm = await direct(A, b);
    const ts = '2026-01-01T00:00:00.000Z';
    const rows = Array.from({ length: 120 }, (_, i) => env.DB.prepare(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at) VALUES (?, ?, ?, 'text', ?, ?)`)
      .bind(`m${String(i).padStart(3, '0')}`, dm, i % 2 ? a : b, `n${i}`, ts));
    await env.DB.batch(rows);
    const p1 = await page(A, dm);
    expect(p1.messages).toHaveLength(50);
    expect(p1.next).toBe(p1.messages[49]!.id);
    const p2 = await page(A, dm, `?before=${p1.next}`);
    const p3 = await page(A, dm, `?before=${p2.next}`);
    expect([p2.messages.length, p3.messages.length, p3.next]).toEqual([50, 20, null]);
    const all = [...p1.messages, ...p2.messages, ...p3.messages].map((m) => m.id);
    expect(new Set(all).size).toBe(120);
    expect(all).toEqual([...all].sort().reverse());
    expect((await page(A, dm, '?limit=10')).messages).toHaveLength(10);
    for (const qs of ['?limit=0', '?limit=51', '?limit=x', '?before=']) expect((await as(A, `/api/conversations/${dm}/messages${qs}`)).status).toBe(400);
  });

  it('messages sent in quick succession keep their order', async () => {
    const dm = await direct(A, b);
    for (let i = 0; i < 10; i++) await say(i % 2 ? A : B, dm, `n${i}`);
    expect((await page(A, dm)).messages.map((m) => m.text)).toEqual(['n9', 'n8', 'n7', 'n6', 'n5', 'n4', 'n3', 'n2', 'n1', 'n0']);
  });

  it('only the first page marks the chat read; sending marks it read for the sender', async () => {
    const dm = await direct(A, b);
    const m = await say(A, dm, 'one');
    const readAt = (u: string) => env.DB.prepare('SELECT last_read_at AS t FROM conversation_members WHERE conversation_id = ? AND user_id = ?').bind(dm, u).first<{ t: string | null }>().then((r) => r!.t);
    expect(await readAt(b)).toBeNull();
    expect(await unread(B)).toBe(1);
    await as(B, `/api/conversations/${dm}/messages?before=${m.id}`);
    expect(await readAt(b)).toBeNull();
    expect(await unread(B)).toBe(1);
    await page(B, dm);
    expect(await readAt(b)).not.toBeNull();
    expect(await unread(B)).toBe(0);
    expect(await unread(A)).toBe(0);
  });

  it('a rec carries a rebuilt snapshot (unknown keys dropped) and its note; the note is optional', async () => {
    const dm = await direct(A, b);
    const res = await as(A, `/api/conversations/${dm}/messages`, 'POST', { rec: { ...REC, extra: 'x', rating: undefined }, text: 'you will like it' });
    expect(res.status).toBe(201);
    const m = await json<Message>(res);
    expect(m).toMatchObject({ kind: 'rec', text: 'you will like it', rec: { ...REC, rating: null } });
    expect(m.rec).not.toHaveProperty('extra');
    const bare = await as(A, `/api/conversations/${dm}/messages`, 'POST', { rec: { category: 'books', title: 'Dune' } });
    expect(bare.status).toBe(201);
    expect((await json<Message>(bare)).rec).toEqual({ category: 'books', title: 'Dune', creator: null, coverUrl: '', rating: null, source: null, sourceId: null });
    for (const rec of [{ ...REC, coverUrl: 'javascript:alert(1)' }, { ...REC, title: '' }, { ...REC, rating: 11 }, { ...REC, source: 'nope' }]) {
      expect((await as(A, `/api/conversations/${dm}/messages`, 'POST', { rec })).status).toBe(400);
    }
    expect((await page(B, dm)).messages[1]!.rec!.title).toBe('Frieren');
  });

  it('30 messages a minute per user: the 31st is 429, another user is not held up, an old minute does not count', async () => {
    const dm = await direct(A, b);
    const g = await group(A, [b, c]);
    for (let i = 0; i < 30; i++) await say(A, i % 2 ? dm : g, `n${i}`);
    const res = await as(A, `/api/conversations/${dm}/messages`, 'POST', { text: 'too many' });
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({ error: 'rate_limited' });
    expect((await upload(A, dm, PNG)).status).toBe(429);
    await say(B, dm, 'fine');
    const old = new Date(Date.now() - 61_000).toISOString();
    await env.DB.prepare('UPDATE messages SET created_at = ? WHERE sender_id = ?').bind(old, a).run();
    await say(A, dm, 'again');
  });
});

describe('deleting (M5)', () => {
  it('soft: body and rec go, the row stays as "deleted"; own only; twice is fine', async () => {
    const dm = await direct(A, b);
    const t = await say(A, dm, 'secret');
    const r = await json<Message>(await as(A, `/api/conversations/${dm}/messages`, 'POST', { rec: REC, text: 'note' }));
    expect(await json(await as(B, `/api/messages/${t.id}`, 'DELETE'))).toEqual({ error: 'forbidden' });
    expect((await as(A, `/api/messages/${t.id}`, 'DELETE')).status).toBe(204);
    expect((await as(A, `/api/messages/${t.id}`, 'DELETE')).status).toBe(204);
    expect((await as(A, `/api/messages/${r.id}`, 'DELETE')).status).toBe(204);
    expect((await as(A, '/api/messages/nope', 'DELETE')).status).toBe(404);
    const row = await env.DB.prepare('SELECT body, rec_json, deleted_at FROM messages WHERE id = ?').bind(t.id).first<any>();
    expect(row.body).toBe('');
    expect(row.deleted_at).not.toBeNull();
    expect((await env.DB.prepare('SELECT rec_json FROM messages WHERE id = ?').bind(r.id).first<any>()).rec_json).toBeNull();
    const p = await page(B, dm);
    expect(p.messages.map((m) => ({ text: m.text, deleted: m.deleted, rec: m.rec }))).toEqual([
      { text: '', deleted: true, rec: null }, { text: '', deleted: true, rec: null },
    ]);
    // a deleted message neither shows in Recommended nor counts as unread
    expect((await json<{ items: unknown[] }>(await as(B, '/api/messages/recommended'))).items).toEqual([]);
    expect(await unread(B)).toBe(0);
  });

  it('deleting a picture message deletes the R2 object and the picture is gone', async () => {
    const dm = await direct(A, b);
    const img = await json<Message>(await upload(A, dm, PNG));
    expect((await env.MEDIA!.list()).objects.map((o) => o.key)).toEqual([`msg/${dm}/${img.id}`]);
    expect((await as(B, `/api/messages/${img.id}/image`)).status).toBe(200);
    expect((await as(A, `/api/messages/${img.id}`, 'DELETE')).status).toBe(204);
    expect((await env.MEDIA!.list()).objects).toEqual([]);
    expect((await as(B, `/api/messages/${img.id}/image`)).status).toBe(404);
    expect((await page(B, dm)).messages[0]).toMatchObject({ kind: 'image', image: false, deleted: true });
  });
});

describe('pictures (M6)', () => {
  it('stores jpeg, png and webp at msg/<conv>/<id>; members fetch them with private immutable nosniff headers', async () => {
    const dm = await direct(A, b);
    for (const [bytes, type] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']] as const) {
      const res = await upload(A, dm, bytes, type);
      expect(res.status).toBe(201);
      const m = await json<Message>(res);
      expect(m).toMatchObject({ kind: 'image', image: true, text: '', senderId: a });
      const got = await as(B, `/api/messages/${m.id}/image`);
      expect(got.status).toBe(200);
      expect(got.headers.get('content-type')).toBe(type);
      expect(got.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(got.headers.get('x-content-type-options')).toBe('nosniff');
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
      expect(await env.MEDIA!.head(`msg/${dm}/${m.id}`)).not.toBeNull();
    }
    expect((await page(B, dm)).messages.filter((m) => m.image)).toHaveLength(3);
  });

  it('wrong type 415, over 5 MB 413, wrong magic bytes 400, empty 400, nothing stored; a content-type with parameters is fine', async () => {
    const dm = await direct(A, b);
    expect((await upload(A, dm, PNG, 'image/gif')).status).toBe(415);
    expect((await upload(A, dm, PNG, 'text/plain')).status).toBe(415);
    expect((await upload(A, dm, JPEG, 'image/png')).status).toBe(400); // JPEG bytes labelled PNG
    expect((await upload(A, dm, new TextEncoder().encode('<svg onload=alert(1)>............'), 'image/png')).status).toBe(400);
    expect((await upload(A, dm, new Uint8Array(0), 'image/png')).status).toBe(400);
    expect((await upload(A, dm, PNG.slice(0, 8), 'image/png')).status).toBe(400);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload(A, dm, big, 'image/png')).status).toBe(413);
    const ok = new Uint8Array(5 * 1024 * 1024);
    ok.set(PNG);
    expect((await upload(A, dm, ok, 'image/png; charset=binary')).status).toBe(201);
    expect((await env.MEDIA!.list()).objects).toHaveLength(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>())!.n).toBe(1);
  });

  it('a lie about the length in a chunked body is still capped', async () => {
    const dm = await direct(A, b);
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) {
        ctl.enqueue(PNG);
        for (let i = 0; i < 6; i++) ctl.enqueue(new Uint8Array(1024 * 1024));
        ctl.close();
      },
    });
    const res = await app.fetch(
      new Request(`https://app.test/api/conversations/${dm}/messages/image`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: stream, duplex: 'half' } as RequestInit),
      { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );
    expect(res.status).toBe(413);
  });

  it('without the MEDIA binding: sending a picture is 503 not_configured (text still works, a non-member still 404)', async () => {
    const dm = await direct(A, b);
    const res = await upload(A, dm, PNG, 'image/png', { MEDIA: undefined });
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'not_configured' });
    expect((await upload(D, dm, PNG, 'image/png', { MEDIA: undefined })).status).toBe(404);
    await say(A, dm, 'text is fine');
    const img = await json<Message>(await upload(A, dm, PNG));
    expect((await run(B, `/api/messages/${img.id}/image`, {}, undefined, { MEDIA: undefined })).status).toBe(503);
  });

  it('the global CSRF rules still hold: a cross-origin picture is 403, an image type elsewhere is 415', async () => {
    const dm = await direct(A, b);
    const cross = await run(A, `/api/conversations/${dm}/messages/image`, { method: 'POST', headers: { 'content-type': 'image/png', Origin: 'https://evil.test' }, body: PNG });
    expect(cross.status).toBe(403);
    const site = await run(A, `/api/conversations/${dm}/messages/image`, { method: 'POST', headers: { 'content-type': 'image/png', 'Sec-Fetch-Site': 'cross-site' }, body: PNG });
    expect(site.status).toBe(403);
    const other = await run(A, `/api/conversations/${dm}/messages`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG });
    expect(other.status).toBe(415);
  });

  it('a picture in a group is the group\'s: every member sees it, a leaver does not', async () => {
    const g = await group(A, [b, c]);
    const img = await json<Message>(await upload(A, g, PNG));
    expect((await as(C, `/api/messages/${img.id}/image`)).status).toBe(200);
    await as(C, `/api/conversations/${g}/members/me`, 'DELETE');
    expect((await as(C, `/api/messages/${img.id}/image`)).status).toBe(404);
  });
});

describe('recommended (M7)', () => {
  it('lists recs sent to you from your chats, newest first, never your own, with the sender', async () => {
    const dm = await direct(A, b);
    const g = await group(C, [a, b]);
    const other = await direct(C, a);
    await as(A, `/api/conversations/${dm}/messages`, 'POST', { rec: { ...REC, title: 'First' } });
    await as(C, `/api/conversations/${g}/messages`, 'POST', { rec: { ...REC, title: 'Second' }, text: 'trust me' });
    await as(B, `/api/conversations/${dm}/messages`, 'POST', { rec: { ...REC, title: 'Mine' } });
    await as(C, `/api/conversations/${other}/messages`, 'POST', { rec: { ...REC, title: 'Not yours' } });
    await say(A, dm, 'plain text');
    const res = await as(B, '/api/messages/recommended');
    expect(res.status).toBe(200);
    const { items } = await json<{ items: { message: Message; sender: { username: string } }[] }>(res);
    expect(items.map((i) => i.message.rec!.title)).toEqual(['Second', 'First']);
    expect(items.map((i) => i.sender.username)).toEqual(['rex', 'dan']);
    expect(items[0]!.message.text).toBe('trust me');
    expect((await json<{ items: unknown[] }>(await as(D, '/api/messages/recommended'))).items).toEqual([]);
  });

  it('is capped at 100', async () => {
    const dm = await direct(A, b);
    const ts = '2026-01-01T00:00:00.000Z';
    await env.DB.batch(Array.from({ length: 105 }, (_, i) => env.DB.prepare(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, rec_json, created_at) VALUES (?, ?, ?, 'rec', '', '{"category":"anime","title":"t","creator":null,"coverUrl":"","rating":null,"source":null,"sourceId":null}', ?)`)
      .bind(`r${i}`, dm, a, ts)));
    expect((await json<{ items: unknown[] }>(await as(B, '/api/messages/recommended'))).items).toHaveLength(100);
  });

  it('a removed sender\'s recs and messages disappear', async () => {
    const dm = await direct(A, b);
    await as(A, `/api/conversations/${dm}/messages`, 'POST', { rec: REC });
    await say(A, dm, 'hi');
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(a).run();
    expect((await json<{ items: unknown[] }>(await as(B, '/api/messages/recommended'))).items).toEqual([]);
    expect((await page(B, dm)).messages).toEqual([]);
    expect(await unread(B)).toBe(0);
  });
});

describe('unread (M3)', () => {
  it('counts chats, not messages; own messages and deleted ones do not count; opening clears it', async () => {
    expect(await unread(B)).toBe(0);
    const dm = await direct(A, b);
    const g = await group(A, [b, c]);
    await say(A, dm, '1');
    await say(A, dm, '2');
    const m = await say(A, g, '3');
    expect(await unread(B)).toBe(2);
    expect(await unread(A)).toBe(0);
    await as(A, `/api/messages/${m.id}`, 'DELETE');
    expect(await unread(B)).toBe(1);
    await page(B, dm);
    expect(await unread(B)).toBe(0);
    await say(A, dm, '4');
    expect(await unread(B)).toBe(1);
    // a chat you have left stops counting
    await as(B, `/api/conversations/${dm}`, 'GET');
    await as(B, `/api/conversations/${g}/members/me`, 'DELETE');
    expect(await unread(B)).toBe(1);
  });

  it('keeps feed and requests as before', async () => {
    const res = await as(A, '/api/activity/unread');
    expect(await json(res)).toEqual({ feed: 0, requests: 0, messages: 0 });
  });
});

describe('gates: pending and removed users can do nothing', () => {
  it('a pending user gets 403 pending on every messages route; a removed one is 401', async () => {
    const dm = await direct(A, b);
    const m = await say(A, dm, 'hi');
    const calls: [string, string, unknown?][] = [
      ['GET', '/api/conversations'], ['POST', '/api/conversations', { userIds: [a] }], ['GET', `/api/conversations/${dm}`],
      ['GET', `/api/conversations/${dm}/messages`], ['POST', `/api/conversations/${dm}/messages`, { text: 'x' }],
      ['DELETE', `/api/messages/${m.id}`], ['GET', '/api/messages/recommended'], ['GET', `/api/messages/${m.id}/image`],
    ];
    await env.DB.prepare("UPDATE users SET status = 'pending' WHERE id = ?").bind(b).run();
    for (const [method, path, body] of calls) expect([path, (await as(B, path, method, body)).status]).toEqual([path, 403]);
    expect((await upload(B, dm, PNG)).status).toBe(403);
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(b).run();
    for (const [method, path, body] of calls) expect([path, (await as(B, path, method, body)).status]).toEqual([path, 401]);
  });

  it('a removed user is dropped from member lists and can not be messaged; the chat goes on for the rest', async () => {
    const g = await group(A, [b, c]);
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(c).run();
    expect((await json<Conversation>(await as(A, `/api/conversations/${g}`))).members.map((m) => m.username).sort()).toEqual(['dan', 'ren']);
    await say(A, g, 'still works');
  });

  it('deleting an account removes its messages by cascade; groups keep going (M9)', async () => {
    const g = await group(A, [b, c]);
    await say(B, g, 'from ren');
    await say(A, g, 'from dan');
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(b).run();
    const p = await page(A, g);
    expect(p.messages.map((m) => m.text)).toEqual(['from dan']);
    expect((await json<Conversation>(await as(A, `/api/conversations/${g}`))).members).toHaveLength(2);
  });
});

describe('query counts (+ sign-in 1)', () => {
  it.each([
    ['GET /conversations', 2],
    ['GET /conversations/:id', 2],
    ['GET messages (first page)', 2],
    ['GET messages (older page)', 2],
    ['POST message', 1],
    ['POST picture', 1],
    ['GET image', 1],
    ['DELETE message', 2],
    ['GET recommended', 1],
    ['GET unread', 1],
  ])('%s', async (name, routeQueries) => {
    const g = await group(A, [b, c], 'Trio');
    const m = await say(B, g, 'hi');
    const img = await json<Message>(await upload(B, g, PNG));
    const spy = spyD1(env.DB);
    const call: Record<string, () => Promise<Response> | Response> = {
      'GET /conversations': () => as(A, '/api/conversations', 'GET', undefined, spy.db),
      'GET /conversations/:id': () => as(A, `/api/conversations/${g}`, 'GET', undefined, spy.db),
      'GET messages (first page)': () => as(A, `/api/conversations/${g}/messages`, 'GET', undefined, spy.db),
      'GET messages (older page)': () => as(A, `/api/conversations/${g}/messages?before=${img.id}`, 'GET', undefined, spy.db),
      'POST message': () => as(A, `/api/conversations/${g}/messages`, 'POST', { text: 'x' }, spy.db),
      'POST picture': () => upload(A, g, PNG, 'image/png', {}, spy.db),
      'GET image': () => as(A, `/api/messages/${img.id}/image`, 'GET', undefined, spy.db),
      'DELETE message': () => as(B, `/api/messages/${m.id}`, 'DELETE', undefined, spy.db),
      'GET recommended': () => as(A, '/api/messages/recommended', 'GET', undefined, spy.db),
      'GET unread': () => as(A, '/api/activity/unread', 'GET', undefined, spy.db),
    };
    const res = await call[name]!();
    expect(res.status).toBeLessThan(300);
    const extra = name === 'POST message' || name === 'POST picture' ? 3 : name === 'GET messages (first page)' ? 1 : 0; // the send batch's 3 statements; the read mark
    expect(spy.queries).toBe(1 + routeQueries + extra);
    expect(spy.maxParams).toBeLessThanOrEqual(10);
  });

  it('the list stays at 3 queries however many chats there are', async () => {
    for (let i = 0; i < 5; i++) await group(A, [b, c]);
    const spy = spyD1(env.DB);
    expect((await as(A, '/api/conversations', 'GET', undefined, spy.db)).status).toBe(200);
    expect(spy.queries).toBe(3);
  });
});
