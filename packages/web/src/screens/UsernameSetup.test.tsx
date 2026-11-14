import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

describe('UsernameSetup', () => {
  it("shows the server's taken message from a 409", async () => {
    const calls = mockApi(makeMe({ username: null }), { 'PUT /api/me/username': { status: 409, body: { error: 'taken' } } });
    renderApp('/setup/username');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Username' }), 'dan');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That username is taken. Try another one.');
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ username: 'dan' });
  });

  it('explains the rules on a 400', async () => {
    mockApi(makeMe({ username: null }), { 'PUT /api/me/username': { status: 400, body: { error: 'invalid' } } });
    renderApp('/setup/username');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Username' }), 'dan!');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('3–20 characters: letters, numbers and _ only.');
  });

  it('goes to the first list once the name is saved', async () => {
    const me = makeMe({ username: null });
    mockApi(me, { 'PUT /api/me/username': (b) => ({ body: { ...me, username: (b as { username: string }).username } }) });
    const { router } = renderApp('/setup/username');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Username' }), 'dan');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
  });

  it('every route redirects to setup while the username is null', async () => {
    mockApi(makeMe({ username: null }));
    const { router } = renderApp('/list/anime');
    await waitFor(() => expect(router.state.location.pathname).toBe('/setup/username'));
    expect(await screen.findByRole('heading', { name: 'Pick a username' })).toBeInTheDocument();
  });
});
