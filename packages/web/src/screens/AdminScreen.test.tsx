import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { setViewportWidth } from '../test/viewport';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const U = (username: string) => ({ id: `id-${username}`, username, displayName: null, avatarAt: null });
const ADMIN = {
  seats: { used: 4, total: 50 },
  invites: [
    { email: 'ren@x.com', invitedAt: '2026-11-10T00:00:00Z', joined: U('ren') },
    { email: 'vance@x.com', invitedAt: '2026-11-09T00:00:00Z', joined: null },
  ],
  users: [
    { ...U('dan'), email: 'dan@example.com', joinedAt: '2026-10-01T00:00:00Z' },
    { ...U('ren'), email: 'ren@x.com', joinedAt: '2026-11-10T00:00:00Z' },
    { ...U('alberto'), email: 'alberto@x.com', joinedAt: '2026-10-05T00:00:00Z' },
  ],
};

function open(extra: Parameters<typeof mockApi>[1] = {}) {
  const calls = mockApi(makeMe({ isAdmin: true }), { 'GET /api/admin': { body: ADMIN }, ...extra });
  const r = renderApp('/admin');
  return { calls, ...r };
}

describe('Admin screen', () => {
  it('lists rows "Joined as @ren" / "Not joined yet" under "Approved · 4 of 50"', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Approved · 4 of 50' })).toBeInTheDocument();
    const row = (email: string) => screen.getByText(email).closest('li')!;
    expect(within(row('ren@x.com')).getByText('Joined as @ren')).toBeInTheDocument();
    expect(within(row('vance@x.com')).getByText('Not joined yet')).toBeInTheDocument();
    expect(within(row('alberto@x.com')).getByText('Joined as @alberto')).toBeInTheDocument(); // signed in before invites existed
    expect(within(row('dan@example.com')).getByText('You')).toBeInTheDocument();
    expect(within(row('dan@example.com')).queryByRole('button')).not.toBeInTheDocument(); // you can't remove yourself
  });

  it('approve "Ren@X.com" shows "Approved ren@x.com" with the link and Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { calls } = open({ 'POST /api/admin/invites': { body: { email: 'ren@x.com', link: 'https://mt.example/add/k3f9x2m8q1ab', alreadyAllowed: false } } });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Email' }), ' Ren@X.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const status = await screen.findByRole('status', { name: 'Approval result' });
    expect(status).toHaveTextContent('Approved ren@x.com');
    expect(within(status).getByRole('textbox', { name: 'Invite link' })).toHaveValue('https://mt.example/add/k3f9x2m8q1ab');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'Ren@X.com' });
    await userEvent.click(within(status).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('https://mt.example/add/k3f9x2m8q1ab');
  });

  it('alreadyAllowed → "ren@x.com could already sign in" with the link', async () => {
    open({ 'POST /api/admin/invites': { body: { email: 'ren@x.com', link: 'https://mt.example/add/abc', alreadyAllowed: true } } });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Email' }), 'ren@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('status', { name: 'Approval result' })).toHaveTextContent('ren@x.com could already sign in');
    expect(screen.getByRole('textbox', { name: 'Invite link' })).toBeInTheDocument();
  });

  it('502 → "Cloudflare refused: Authentication error"', async () => {
    open({ 'POST /api/admin/invites': { status: 502, body: { error: 'cloudflare', message: 'Authentication error' } } });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Email' }), 'ren@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cloudflare refused: Authentication error');
    expect(screen.queryByRole('status', { name: 'Approval result' })).not.toBeInTheDocument();
  });

  it("503 → \"Admin invites aren't set up yet. See SETUP step 12.\"", async () => {
    open({ 'POST /api/admin/invites': { status: 503, body: { error: 'not_configured' } } });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Email' }), 'ren@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Admin invites aren't set up yet. See SETUP step 12.");
  });

  it('400 bad_email says so in plain words', async () => {
    open({ 'POST /api/admin/invites': { status: 400, body: { error: 'bad_email' } } });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Email' }), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That doesn't look like an email address.");
  });

  it('Remove access asks first ("They won\'t be able to sign in. Their data stays."), then DELETEs and drops the row', async () => {
    let gone = false;
    const { calls } = open({
      'GET /api/admin': () => ({ body: gone ? { ...ADMIN, invites: ADMIN.invites.slice(0, 1) } : ADMIN }),
      'DELETE /api/admin/invites/:email': () => { gone = true; return { body: { removed: true } }; },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove access for vance@x.com' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove access for vance@x.com?' });
    expect(within(dialog).getByText("They won't be able to sign in. Their data stays.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/api/admin/invites/vance%40x.com');
    expect(await screen.findByText('Removed access for vance@x.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('vance@x.com')).not.toBeInTheDocument());
  });

  it('Cancel removes nothing', async () => {
    const { calls } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove access for ren@x.com' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it.each([
    [400, { error: 'last_rule' }, "That's the last approved email. Cloudflare needs at least one, so it can't be removed."],
    [400, { error: 'self' }, "That's your own email. You can't remove your own access."],
    [502, { error: 'cloudflare', message: 'Authentication error' }, 'Cloudflare refused: Authentication error'],
    [503, { error: 'not_configured' }, "Admin invites aren't set up yet. See SETUP step 12."],
    [500, { error: 'x' }, "Couldn't remove access. Check your connection and try again."],
  ])('remove error %s %j → "%s" and the sheet stays open', async (status, body, text) => {
    open({ 'DELETE /api/admin/invites/:email': { status, body } });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove access for ren@x.com' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove access' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('removed:false says it was already off the list', async () => {
    open({ 'DELETE /api/admin/invites/:email': { body: { removed: false } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove access for ren@x.com' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove access' }));
    expect(await screen.findByText('ren@x.com was already off the list')).toBeInTheDocument();
  });

  it('a failed load offers Retry; the PC side nav has an Admin row for the admin', async () => {
    let n = 0;
    setViewportWidth(1200);
    open({ 'GET /api/admin': () => (n++ === 0 ? { status: 500, body: { error: 'x' } } : { body: ADMIN }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Approved · 4 of 50' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('non-admins never see the side-nav Admin row', async () => {
    setViewportWidth(1200);
    mockApi(makeMe({ isAdmin: false }));
    renderApp('/more');
    await within(await screen.findByRole('navigation', { name: 'Main' })).findByRole('link', { name: 'About' });
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });
});
