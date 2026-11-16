import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { foldPosts, type ActivityPage, type Entry } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';

const A = 'rerate@example.com';
const as = (path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
  );

describe('re-rating one title several times in a row (Dan, Invincible)', () => {
  it('makes one post, from the first rating to the last', async () => {
    const made = await as('/api/entries', 'POST', { category: 'tv', title: 'Invincible', rating: 9 });
    const { entry } = (await made.json()) as { entry: Entry };
    for (const r of [9.2, 9.8, 9.4, 9.7, 9.6]) expect((await as(`/api/entries/${entry.id}`, 'PATCH', { rating: r })).status).toBe(200);
    const page = (await (await as('/api/activity?show=you')).json()) as ActivityPage;
    const posts = foldPosts(page.items);
    expect(posts).toHaveLength(1);
  });
});
