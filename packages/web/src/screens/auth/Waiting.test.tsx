import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authBackend } from '../../test/authBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { WAITING_POLL_MS } from './WaitingScreen';

const meCalls = (calls: { method: string; path: string }[]) => calls.filter((c) => c.method === 'GET' && c.path === '/api/me').length;

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('Waiting for approval', () => {
  const pending = () => makeMe({ username: 'ren', status: 'pending' });

  it('a pending user sees Waiting at any path, with Log out', async () => {
    authBackend({ signedIn: true, me: pending() });
    renderApp('/list/anime');
    expect(await screen.findByRole('heading', { name: 'Thanks, @ren!' })).toBeInTheDocument();
    expect(screen.getByText('Dan needs to approve your account. This page updates by itself.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('polls /api/me every 30 s and flips to the app when the status becomes active', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); // before render: the poll's interval must be the fake one
    const { state, calls } = authBackend({ signedIn: true, me: pending() });
    renderApp('/about');
    await screen.findByRole('heading', { name: 'Thanks, @ren!' });
    const before = meCalls(calls);
    await act(async () => { vi.advanceTimersByTime(WAITING_POLL_MS - 1); });
    expect(meCalls(calls)).toBe(before);
    await act(async () => { vi.advanceTimersByTime(1); });
    await waitFor(() => expect(meCalls(calls)).toBe(before + 1));
    expect(screen.getByRole('heading', { name: 'Thanks, @ren!' })).toBeInTheDocument();

    state.me = { ...state.me, status: 'active' };
    await act(async () => { vi.advanceTimersByTime(WAITING_POLL_MS); });
    expect(await screen.findByRole('heading', { name: /welcome to media tracker/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Thanks, @ren!' })).not.toBeInTheDocument();
  });

  it('does not poll while the page is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { calls } = authBackend({ signedIn: true, me: pending() });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Thanks, @ren!' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const before = meCalls(calls);
    await act(async () => { vi.advanceTimersByTime(WAITING_POLL_MS * 3); });
    expect(meCalls(calls)).toBe(before);
  });

  it('declined while waiting (session gone) returns to sign-in', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { state } = authBackend({ signedIn: true, me: pending() });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Thanks, @ren!' });
    state.signedIn = false;
    await act(async () => { vi.advanceTimersByTime(WAITING_POLL_MS); });
    expect(await screen.findByRole('tab', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('Log out posts /api/auth/logout, clears local data and reloads at /', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { calls } = authBackend({ signedIn: true, me: pending() });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith('/'));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/auth/logout')).toBe(true);
  });
});

describe('Removed', () => {
  it('401 removed shows the removed message with Log out', async () => {
    authBackend({ me401: { status: 401, body: { error: 'removed' } } });
    renderApp('/list/anime');
    expect(await screen.findByRole('heading', { name: 'Your access was removed.' })).toBeInTheDocument();
    expect(screen.getByText('Ask Dan if this is a mistake.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('a user removed mid-session lands on the removed message', async () => {
    const { state } = authBackend({ signedIn: true, me: makeMe() });
    const { queryClient } = renderApp('/about');
    await screen.findByRole('heading', { name: /welcome to media tracker/i });
    state.signedIn = false;
    state.me401 = { status: 401, body: { error: 'removed' } };
    await queryClient.refetchQueries({ queryKey: ['me'] }).catch(() => undefined);
    expect(await screen.findByRole('heading', { name: 'Your access was removed.' })).toBeInTheDocument();
  });
});
