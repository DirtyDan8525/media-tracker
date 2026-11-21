import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AFTER_SETUP_KEY } from '../../data/social';
import { localDb } from '../../db/local';
import { authBackend } from '../../test/authBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const tab = (name: string) => screen.findByRole('tab', { name });

describe('signed-out screen', () => {
  it('shows Sign in / Create account at any path and remembers the path', async () => {
    authBackend();
    renderApp('/add/k3f9x2m8q1ab');
    expect(await tab('Create account')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Media Tracker')).toBeInTheDocument();
    expect(sessionStorage.getItem(AFTER_SETUP_KEY)).toBe('/add/k3f9x2m8q1ab');
  });

  it('after sign-in the app opens at the remembered path', async () => {
    const { calls } = authBackend({ me: makeMe({ username: 'ren' }) });
    const { router } = renderApp('/about');
    await userEvent.click(await tab('Sign in'));
    await userEvent.type(screen.getByLabelText('Username'), 'Ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    expect(await screen.findByRole('heading', { name: /welcome to media tracker/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/about');
    expect(calls.find((c) => c.path === '/api/auth/login')?.body).toEqual({ username: 'ren', password: 'hunter2hunter2' });
    expect(sessionStorage.getItem(AFTER_SETUP_KEY)).toBeNull();
  });

  it('inputs carry autocomplete hints, and Show password reveals it', async () => {
    authBackend();
    renderApp('/');
    await tab('Create account');
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Your name (optional)')).toHaveAttribute('autocomplete', 'name');
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('autocomplete', 'new-password');
    expect(pw).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(pw).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('tab', { name: 'Sign in' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('sign up posts username, name and password; a pending account lands on Waiting', async () => {
    const { calls } = authBackend({ me: makeMe({ username: 'ren', status: 'pending' }) });
    renderApp('/');
    await userEvent.type(await screen.findByLabelText('Username'), 'Ren');
    await userEvent.type(screen.getByLabelText('Your name (optional)'), ' Ren R ');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    expect(await screen.findByRole('heading', { name: 'Thanks, @ren!' })).toBeInTheDocument();
    expect(screen.getByText('Dan needs to approve your account. This page updates by itself.')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/signup')?.body).toEqual({ username: 'ren', password: 'hunter2hunter2', displayName: 'Ren R' });
  });

  it('sign up leaves displayName out when the name is blank', async () => {
    const { calls } = authBackend({ me: makeMe({ username: 'ren', status: 'pending' }) });
    renderApp('/');
    await userEvent.type(await screen.findByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Thanks, @ren!' });
    expect(calls.find((c) => c.path === '/api/auth/signup')?.body).toEqual({ username: 'ren', password: 'hunter2hunter2' });
  });

  it('the first account (active admin) goes straight into the app', async () => {
    authBackend({ me: makeMe({ username: 'dan', isAdmin: true }) });
    renderApp('/about');
    await userEvent.type(await screen.findByLabelText('Username'), 'dan');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    expect(await screen.findByRole('heading', { name: /welcome to media tracker/i })).toBeInTheDocument();
  });

  it('checks the username and password rules before asking the server', async () => {
    const { calls } = authBackend();
    renderApp('/');
    await userEvent.type(await screen.findByLabelText('Username'), 'a!');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('3–20 characters: letters, numbers and _ only.');
    await userEvent.clear(screen.getByLabelText('Username'));
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'short{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 8 characters.');
    expect(calls.some((c) => c.path === '/api/auth/signup')).toBe(false);
  });

  it.each([
    ['sign in', 'Sign in', 'POST /api/auth/login', 401, { error: 'bad_credentials' }, "That username or password isn't right."],
    ['sign in', 'Sign in', 'POST /api/auth/login', 429, { error: 'too_many_attempts' }, 'Too many tries. Wait 15 minutes and try again.'],
    ['sign in', 'Sign in', 'POST /api/auth/login', 403, { error: 'removed' }, 'Your access was removed. Ask Dan if this is a mistake.'],
    ['sign in', 'Sign in', 'POST /api/auth/login', 500, { error: 'x' }, "Couldn't sign you in. Check your connection and try again."],
    ['sign up', 'Create account', 'POST /api/auth/signup', 409, { error: 'taken' }, 'That username is taken.'],
  ])('%s error %#: %s', async (_n, tabName, key, status, body, text) => {
    authBackend({ extra: { [key]: { status, body } } });
    renderApp('/');
    await userEvent.click(await tab(tabName));
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    // still on the screen, button usable again
    expect(screen.getByRole('button', { name: tabName })).toBeEnabled();
  });

  it('after a wrong password only the password clears, and focus goes to it', async () => {
    authBackend({ extra: { 'POST /api/auth/login': { status: 401, body: { error: 'bad_credentials' } } } });
    renderApp('/');
    await userEvent.click(await tab('Sign in'));
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongwrong{Enter}');
    const alert = await screen.findByRole('alert');
    expect(screen.getByLabelText('Username')).toHaveValue('ren');
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveValue('');
    await waitFor(() => expect(pw).toHaveFocus());
    expect(pw).toHaveAttribute('aria-invalid', 'true');
    expect(pw.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('a network failure keeps the typed password but still returns focus to it', async () => {
    authBackend({ extra: { 'POST /api/auth/login': { status: 500, body: { error: 'x' } } } });
    renderApp('/');
    await userEvent.click(await tab('Sign in'));
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Username')).toHaveValue('ren');
    expect(screen.getByLabelText('Password')).toHaveValue('hunter2hunter2');
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveFocus());
  });

  it('a bad_credentials answer does not pull the screen out from under you (stays signed out)', async () => {
    authBackend({ extra: { 'POST /api/auth/login': { status: 401, body: { error: 'bad_credentials' } } } });
    renderApp('/');
    await userEvent.click(await tab('Sign in'));
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    await screen.findByRole('alert');
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Username')).toHaveValue('ren');
  });

  it('disables the button while submitting', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    authBackend({ me: makeMe({ username: 'ren' }), extra: { 'POST /api/auth/login': async () => { await gate; return { body: makeMe({ username: 'ren' }) }; } } });
    renderApp('/about');
    await userEvent.click(await tab('Sign in'));
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled();
    release();
    await screen.findByRole('heading', { name: /welcome to media tracker/i });
  });

  it("signing in as someone else wipes the last person's on-device copy", async () => {
    await localDb.me.put({ key: 'me', value: makeMe({ id: 'old', username: 'old' }) });
    await localDb.entries.put({ id: 'e1', category: 'anime', title: 'X', rating: 5 } as never);
    authBackend({ me: makeMe({ id: 'new', username: 'ren' }) });
    renderApp('/about');
    await userEvent.click(await tab('Sign in'));
    await userEvent.type(screen.getByLabelText('Username'), 'ren');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    await screen.findByRole('heading', { name: /welcome to media tracker/i });
    await waitFor(async () => expect(await localDb.entries.count()).toBe(0));
  });

  it('a 401 from any call mid-session sends the app back to sign-in', async () => {
    const { state } = authBackend({ signedIn: true, me: makeMe() });
    const { queryClient } = renderApp('/about');
    await screen.findByRole('heading', { name: /welcome to media tracker/i });
    state.signedIn = false;
    await queryClient.refetchQueries({ queryKey: ['me'] }).catch(() => undefined);
    expect(await tab('Sign in')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /welcome to media tracker/i })).not.toBeInTheDocument();
  });
});
