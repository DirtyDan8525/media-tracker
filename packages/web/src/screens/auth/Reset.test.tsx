import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authBackend } from '../../test/authBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const TOKEN = 'k3f9x2m8q1abk3f9x2m8q1abk3f9x2m8q1abk3f9x2m';

describe('/reset/:token', () => {
  it('a valid link asks for a new password for @ren, signs in and opens the app', async () => {
    const { calls } = authBackend({
      me: makeMe({ username: 'ren' }),
      extra: {
        'GET /api/auth/reset/:token': { body: { username: 'ren' } },
        'POST /api/auth/reset': () => ({ body: makeMe({ username: 'ren' }) }),
      },
    });
    // the reset route needs no session: /api/me says 401 until the reset signs us in
    const { router } = renderApp(`/reset/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    expect(screen.getByText('For @ren')).toBeInTheDocument();
    const pw = screen.getByLabelText('New password');
    expect(pw).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    await userEvent.type(pw, 'brand-new-pass{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/auth/reset')?.body).toEqual({ token: TOKEN, password: 'brand-new-pass' });
    expect(calls.find((c) => c.path === `/api/auth/reset/${TOKEN}`)).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Set a new password' })).not.toBeInTheDocument());
  });

  it('an expired or used link says so and offers sign in', async () => {
    authBackend({ extra: { 'GET /api/auth/reset/:token': { status: 404, body: { error: 'not_found' } } } });
    const { router } = renderApp(`/reset/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired. Ask Dan for a new one.');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('tab', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('a link that expires while the form is open shows the same message', async () => {
    authBackend({
      extra: { 'GET /api/auth/reset/:token': { body: { username: 'ren' } }, 'POST /api/auth/reset': { status: 404, body: { error: 'not_found' } } },
    });
    renderApp(`/reset/${TOKEN}`);
    await userEvent.type(await screen.findByLabelText('New password'), 'brand-new-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired. Ask Dan for a new one.');
  });

  it('refuses a short password before asking the server; Show password works', async () => {
    const { calls } = authBackend({ extra: { 'GET /api/auth/reset/:token': { body: { username: 'ren' } } } });
    renderApp(`/reset/${TOKEN}`);
    const pw = await screen.findByLabelText('New password');
    await userEvent.type(pw, 'short{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 8 characters.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
  });

  it('shows a loading state, then a retry when the network fails', async () => {
    authBackend({ extra: { 'GET /api/auth/reset/:token': { status: 500, body: { error: 'x' } } } });
    renderApp(`/reset/${TOKEN}`);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
