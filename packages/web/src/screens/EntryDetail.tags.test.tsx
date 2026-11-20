import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TagInfo } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import type { Handler } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

/** Tag routes over a tiny in-memory store (the Worker's rules: case-insensitive names, tags A-Z). */
function tagRoutes(initial: Record<string, string[]>, known: string[] = []): Record<string, Handler> {
  const onEntry = new Map(Object.entries(initial).map(([k, v]) => [k, [...v]]));
  const all = new Set([...known, ...[...onEntry.values()].flat()]);
  const sorted = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return {
    'GET /api/tags': () => ({ body: [...all].sort().map((name): TagInfo => ({ id: `t-${name}`, name, count: 1 })) }),
    'POST /api/entries/:id/tags': (b, _u, p) => {
      const name = (b as { name: string }).name;
      const list = onEntry.get(p.id!) ?? [];
      if (!list.some((t) => t.toLowerCase() === name.toLowerCase())) list.push(name);
      onEntry.set(p.id!, list);
      all.add(name);
      return { status: 201, body: { tags: sorted(list) } };
    },
    'DELETE /api/entries/:id/tags/:name': (_b, _u, p) => {
      const list = (onEntry.get(p.id!) ?? []).filter((t) => t.toLowerCase() !== p.name!.toLowerCase());
      onEntry.set(p.id!, list);
      return { body: { tags: list } };
    },
  };
}
const frieren = (over = {}) => makeEntry({ id: 'f1', title: 'Frieren', status: 'Completed', rating: 9, ...over });
const patches = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'PATCH' && c.path === '/api/entries/f1').map((c) => c.body as Record<string, unknown>);

describe('entry details: Tags', () => {
  it('shows the chips and removes one with its ✕', async () => {
    const { calls } = fakeBackend({ entries: [frieren({ tags: ['Comfy', 'With Ren'] })], extra: tagRoutes({ f1: ['Comfy', 'With Ren'] }) });
    renderApp('/entry/f1');
    const region = await screen.findByRole('region', { name: 'Tags' });
    expect(within(region).getByText('Comfy')).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Remove tag Comfy' }));
    await waitFor(() => expect(within(region).queryByText('Comfy')).not.toBeInTheDocument());
    expect(within(region).getByText('With Ren')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/entries/f1/tags/Comfy')).toBe(true);
  });

  it('adds a typed tag (Enter), clears the box and keeps focus there', async () => {
    const { calls } = fakeBackend({ entries: [frieren({ tags: [] })], extra: tagRoutes({}) });
    renderApp('/entry/f1');
    const region = await screen.findByRole('region', { name: 'Tags' });
    await userEvent.click(within(region).getByRole('button', { name: '+ Add tag' }));
    const box = within(region).getByRole('textbox', { name: 'New tag' });
    expect(box).toHaveFocus();
    await userEvent.type(box, '  Rewatch {Enter}');
    expect(await within(region).findByRole('button', { name: 'Remove tag Rewatch' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/entries/f1/tags')?.body).toEqual({ name: 'Rewatch' });
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
  });

  it('suggests your existing tags (not ones already on the title), narrowed as you type', async () => {
    fakeBackend({ entries: [frieren({ tags: ['Comfy'] })], extra: tagRoutes({ f1: ['Comfy'] }, ['Rewatch', 'With Alberto']) });
    renderApp('/entry/f1');
    const region = await screen.findByRole('region', { name: 'Tags' });
    await userEvent.click(within(region).getByRole('button', { name: '+ Add tag' }));
    const list = await within(region).findByRole('list', { name: 'Your existing tags' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Rewatch', 'With Alberto']);
    await userEvent.type(within(region).getByRole('textbox', { name: 'New tag' }), 'alb');
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['With Alberto']);
    await userEvent.click(within(list).getByRole('button', { name: 'With Alberto' }));
    expect(await within(region).findByRole('button', { name: 'Remove tag With Alberto' })).toBeInTheDocument();
  });

  it('Escape closes the add box and returns focus to "+ Add tag"', async () => {
    fakeBackend({ entries: [frieren()], extra: tagRoutes({}) });
    renderApp('/entry/f1');
    const region = await screen.findByRole('region', { name: 'Tags' });
    await userEvent.click(within(region).getByRole('button', { name: '+ Add tag' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(region).getByRole('button', { name: '+ Add tag' })).toHaveFocus());
  });

  it('says why a tag was refused (the 50-tag limit)', async () => {
    fakeBackend({ entries: [frieren()], extra: { ...tagRoutes({}), 'POST /api/entries/:id/tags': { status: 409, body: { error: 'tag_limit' } } } });
    renderApp('/entry/f1');
    const region = await screen.findByRole('region', { name: 'Tags' });
    await userEvent.click(within(region).getByRole('button', { name: '+ Add tag' }));
    await userEvent.type(within(region).getByRole('textbox', { name: 'New tag' }), 'One more{Enter}');
    expect(await screen.findByText(/up to 50 tags/)).toBeInTheDocument();
  });
});

describe('entry details: More stats', () => {
  it('is a closed drop-down at the bottom with Started, Finished and Rewatches', async () => {
    fakeBackend({ entries: [frieren({ startedAt: '2025-09-29', finishedAt: '2026-03-22', rewatches: 1 })], extra: tagRoutes({}) });
    renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1, name: 'Frieren' });
    const stats = document.querySelector<HTMLElement>('details.more-stats')!;
    expect(stats).not.toHaveAttribute('open');
    expect(within(stats).getByText('More stats')).toBeInTheDocument();
    expect(within(stats).getByLabelText('Started')).toHaveValue('2025-09-29');
    expect(within(stats).getByLabelText('Finished')).toHaveValue('2026-03-22');
    expect(within(stats).getByText('1')).toBeInTheDocument();
  });

  it('saves a date, clears one, and steps the rewatches', async () => {
    const { calls } = fakeBackend({ entries: [frieren({ startedAt: '2025-09-29', rewatches: 1 })], extra: tagRoutes({}) });
    renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1, name: 'Frieren' });
    const stats = document.querySelector<HTMLElement>('details.more-stats')!;
    stats.setAttribute('open', '');
    const finished = within(stats).getByLabelText('Finished');
    await userEvent.type(finished, '2026-03-22');
    await waitFor(() => expect(patches(calls)).toContainEqual({ finishedAt: '2026-03-22' }));
    await userEvent.click(within(stats).getByRole('button', { name: 'Clear started date' }));
    await waitFor(() => expect(patches(calls)).toContainEqual({ startedAt: null }));
    await userEvent.click(within(stats).getByRole('button', { name: 'More rewatches' }));
    await waitFor(() => expect(patches(calls)).toContainEqual({ rewatches: 2 }));
    await userEvent.click(within(stats).getByRole('button', { name: 'Fewer rewatches' }));
    await waitFor(() => expect(patches(calls)).toContainEqual({ rewatches: 1 }));
  });

  it('cannot go below 0 rewatches', async () => {
    fakeBackend({ entries: [frieren({ rewatches: 0 })], extra: tagRoutes({}) });
    renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1, name: 'Frieren' });
    expect(within(document.querySelector<HTMLElement>('details.more-stats')!).getByRole('button', { name: 'Fewer rewatches' })).toBeDisabled();
  });

  it('shows Airing only for a TV title whose lookup stored it', async () => {
    fakeBackend({ entries: [frieren({ category: 'tv', lengthLabel: '60 min episodes · Running' })], extra: tagRoutes({}) });
    const { unmount } = renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1, name: 'Frieren' });
    expect(within(document.querySelector<HTMLElement>('details.more-stats')!).getByText('Still airing')).toBeInTheDocument();
    unmount();
    fakeBackend({ entries: [frieren({ category: 'anime', lengthLabel: '28 ep' })], extra: tagRoutes({}) });
    renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1, name: 'Frieren' });
    expect(within(document.querySelector<HTMLElement>('details.more-stats')!).queryByText('Airing')).not.toBeInTheDocument();
  });
});
