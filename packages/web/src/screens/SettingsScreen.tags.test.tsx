import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const tags = () => [
  { id: 't1', name: 'Comfy', count: 3 },
  { id: 't2', name: 'With Ren', count: 1 },
];

describe('Settings > Tags', () => {
  it('has a Tags row that opens the list with counts', async () => {
    mockApi(makeMe(), { 'GET /api/tags': { body: tags() } });
    const { router } = renderApp('/settings');
    await userEvent.click(await screen.findByRole('link', { name: /^Tags/ }));
    expect(router.state.location.pathname).toBe('/settings/tags');
    expect(await screen.findByText('Comfy')).toBeInTheDocument();
    expect(screen.getByText('3 titles')).toBeInTheDocument();
    expect(screen.getByText('1 title')).toBeInTheDocument();
  });

  it('renames a tag (Enter saves) and says when the name is taken', async () => {
    const calls = mockApi(makeMe(), {
      'GET /api/tags': { body: tags() },
      'PATCH /api/tags/:id': (b) => ((b as { name: string }).name === 'With Ren' ? { status: 409, body: { error: 'exists' } } : { body: { id: 't1', name: (b as { name: string }).name } }),
    });
    renderApp('/settings/tags');
    await userEvent.click(await screen.findByRole('button', { name: 'Rename tag Comfy' }));
    const box = screen.getByRole('textbox', { name: 'New name for Comfy' });
    expect(box).toHaveFocus();
    await userEvent.clear(box);
    await userEvent.type(box, 'With Ren{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('already have a tag');
    await userEvent.clear(box);
    await userEvent.type(box, 'Cozy{Enter}');
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH' && c.path === '/api/tags/t1').at(-1)?.body).toEqual({ name: 'Cozy' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /New name/ })).not.toBeInTheDocument());
  });

  it('deletes a tag after a confirm that says how many titles lose it', async () => {
    const calls = mockApi(makeMe(), { 'GET /api/tags': { body: tags() }, 'DELETE /api/tags/:id': { status: 204 } });
    renderApp('/settings/tags');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete tag Comfy' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/removed from 3 titles/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/tags/t1')).toBe(true));
  });

  it('has an empty state', async () => {
    mockApi(makeMe(), { 'GET /api/tags': { body: [] } });
    renderApp('/settings/tags');
    expect(await screen.findByText('No tags yet')).toBeInTheDocument();
  });
});
