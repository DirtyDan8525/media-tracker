import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeMe, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const U = (username: string, over: object = {}) => ({ id: `id-${username}`, username, displayName: null, avatarAt: null, ...over });
const EMPTY = { friends: [], incoming: [], outgoing: [] };

function open(extra: Parameters<typeof mockApi>[1] = {}) {
  const calls = mockApi(makeMe(), {
    'GET /api/friends': { body: EMPTY },
    'GET /api/me/invite': { body: { code: 'k3f9x2m8q1ab' } },
    ...extra,
  });
  const r = renderApp('/friends');
  return { calls, ...r };
}
async function openSheet() {
  await userEvent.click(await screen.findByRole('button', { name: 'Add friend' }));
  return screen.findByRole('dialog', { name: 'Add friend' });
}

describe('Add friend sheet', () => {
  it('typing "re" lists @ren with Add → POST requests, and the row shows "Requested"', async () => {
    const { calls } = open({
      'GET /api/users/search': { body: [U('ren', { displayName: 'Ren' })] },
      'POST /api/friends/requests': { body: { relation: 'pending_out' } },
    });
    const dialog = await openSheet();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Username' }), 're');
    await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.path === '/api/users/search?q=re')).toBe(true));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Add @ren' }));
    expect(await within(dialog).findByText('Requested')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'GET' && c.path === '/api/users/search?q=re')).toBe(true);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/friends/requests')?.body).toEqual({ username: 'ren' });
  });

  it('lists everyone before you type, each with Add', async () => {
    const { calls } = open({ 'GET /api/users/search': { body: [U('alberto'), U('ren'), U('vance')] } });
    const dialog = await openSheet();
    const list = await within(dialog).findByRole('list', { name: 'Everyone' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByRole('button', { name: 'Add @vance' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'GET' && c.path.startsWith('/api/users/search'))?.path).toBe('/api/users/search?q=');
  });

  it('says so when nobody matches, and asks for 2 characters first', async () => {
    open({ 'GET /api/users/search': { body: [] } });
    const dialog = await openSheet();
    const field = within(dialog).getByRole('textbox', { name: 'Username' });
    await userEvent.type(field, 'r');
    expect(within(dialog).getByText(/at least 2/)).toBeInTheDocument();
    await userEvent.type(field, 'x');
    expect(await within(dialog).findByText(/No one has that username/)).toBeInTheDocument();
  });

  it('shows the invite link; Copy writes it to the clipboard and toasts "Link copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();
    const dialog = await openSheet();
    expect(await within(dialog).findByRole('textbox', { name: 'Invite link' })).toHaveValue(`${location.origin}/add/k3f9x2m8q1ab`);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/add/k3f9x2m8q1ab`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('Make a new link asks "The old link will stop working", then POSTs and shows the new one', async () => {
    const { calls } = open({ 'POST /api/me/invite': { body: { code: 'newcode00000' } } });
    const dialog = await openSheet();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Make a new link' }));
    expect(within(dialog).getByText(/The old link will stop working/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/me/invite')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make new link' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Invite link' })).toHaveValue(`${location.origin}/add/newcode00000`));
  });

  it('"Keep old link" leaves it alone', async () => {
    const { calls } = open();
    const dialog = await openSheet();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Make a new link' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep old link' }));
    expect(within(dialog).getByRole('textbox', { name: 'Invite link' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/me/invite')).toBe(false);
  });
});
