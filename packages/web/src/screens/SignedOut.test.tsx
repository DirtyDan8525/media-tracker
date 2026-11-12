import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { REAUTH_FLAG, REAUTH_PATH } from '../api/auth';
import { mockFetch } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

describe("Can't sign you in", () => {
  it('first signed-out signal hops to reauth once; no screen', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    mockFetch({ 'GET /api/me': { status: 401, body: { error: 'unauthorized' } } });
    renderApp('/list/anime');
    await waitFor(() => expect(assign).toHaveBeenCalledWith(REAUTH_PATH));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: "Can't sign you in" })).not.toBeInTheDocument();
  });

  it('a second signal in the same session shows the screen, and its button retries', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    sessionStorage.setItem(REAUTH_FLAG, '1');
    mockFetch({ 'GET /api/me': { status: 401, body: { error: 'unauthorized' } } });
    renderApp('/list/anime');
    expect(await screen.findByRole('heading', { name: "Can't sign you in" })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    // The old flag is cleared and the click takes the normal first-hop path, which records a
    // fresh hop: coming back still signed out shows this screen again, with no extra auto-hop.
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(REAUTH_PATH);
    expect(sessionStorage.getItem(REAUTH_FLAG)).toBe('1');
    expect(screen.queryByRole('heading', { name: "Can't sign you in" })).not.toBeInTheDocument();
  });
});
