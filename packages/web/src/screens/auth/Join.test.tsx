import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { authBackend } from '../../test/authBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const TOKEN = 'k3f9x2m8q1abk3f9x2m8q1abk3f9x2m8q1abk3f9x2m';
const INVITED = "You're invited — your account is ready as soon as you sign up.";
const USED = 'That link was already used or expired — Dan will approve you soon.';
const valid = (v: boolean) => ({ 'GET /api/auth/join/:token': { body: { valid: v } } });

beforeEach(() => sessionStorage.clear());

describe('/join/:token', () => {
  it('works signed out: opens Create account with the invited banner and checks the link', async () => {
    const { calls } = authBackend({ extra: valid(true) });
    renderApp(`/join/${TOKEN}`);
    expect(await screen.findByText(INVITED)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
    expect(calls.find((c) => c.path === `/api/auth/join/${TOKEN}`)).toBeDefined();
    // Dan's approval note does not apply to an invited person
    expect(screen.queryByText(/Dan approves new accounts/)).not.toBeInTheDocument();
    // the link is not remembered as "where to go after sign-in"
    expect(sessionStorage.getItem('mt-after-setup')).toBeNull();
  });

  it('signing up posts the joinToken; an active user goes straight into the app', async () => {
    const { calls } = authBackend({ me: makeMe({ username: 'ren', status: 'active' }), extra: valid(true) });
    const { router } = renderApp(`/join/${TOKEN}`);
    await userEvent.type(await screen.findByLabelText('Username'), 'Ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Create account' })).not.toBeInTheDocument());
    expect(router.state.location.pathname).not.toMatch(/^\/join\//); // left the link; / opens the first list
    expect(calls.find((c) => c.path === '/api/auth/signup')?.body).toEqual({ username: 'ren', password: 'hunter2hunter2', joinToken: TOKEN });
    expect(screen.queryByRole('heading', { name: 'Thanks, @ren!' })).not.toBeInTheDocument();
  });

  it('a link that is already used or expired says so; signing up still works and waits for Dan', async () => {
    const { calls } = authBackend({ me: makeMe({ username: 'ren', status: 'pending' }), extra: valid(false) });
    renderApp(`/join/${TOKEN}`);
    expect(await screen.findByText(USED)).toBeInTheDocument();
    expect(screen.queryByText(INVITED)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    expect(await screen.findByRole('heading', { name: 'Thanks, @ren!' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/signup')?.body).toEqual({ username: 'ren', password: 'hunter2hunter2' });
  });

  it('a link used by someone else a moment before: the signup answer says invalid and Waiting says so', async () => {
    authBackend({
      me: makeMe({ username: 'ren', status: 'pending' }),
      extra: { ...valid(true), 'POST /api/auth/signup': () => ({ status: 201, body: { ...makeMe({ username: 'ren', status: 'pending' }), joinLink: 'invalid' } }) },
    });
    renderApp(`/join/${TOKEN}`);
    await userEvent.type(await screen.findByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    expect(await screen.findByRole('heading', { name: 'Thanks, @ren!' })).toBeInTheDocument();
    expect(screen.getByText(USED)).toBeInTheDocument();
  });

  it('if the check cannot be made, the form still works (no banner) and sends the token', async () => {
    const { calls } = authBackend({ me: makeMe({ username: 'ren', status: 'active' }), extra: { 'GET /api/auth/join/:token': { status: 500, body: { error: 'x' } } } });
    renderApp(`/join/${TOKEN}`);
    await userEvent.type(await screen.findByLabelText('Username'), 'ren');
    expect(screen.queryByText(INVITED)).not.toBeInTheDocument();
    expect(screen.queryByText(USED)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    await waitFor(() => expect(calls.find((c) => c.path === '/api/auth/signup')?.body).toMatchObject({ joinToken: TOKEN }));
  });

  it('the Sign in tab is still there for someone who already has an account', async () => {
    authBackend({ me: makeMe({ username: 'ren' }), extra: valid(true) });
    const { router } = renderApp(`/join/${TOKEN}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Sign in' }));
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Sign in' })).not.toBeInTheDocument());
    expect(router.state.location.pathname).not.toMatch(/^\/join\//); // left the link; / opens the first list
  });
});
