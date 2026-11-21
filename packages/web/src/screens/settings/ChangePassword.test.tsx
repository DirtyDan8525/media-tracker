import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const open = async () => {
  renderApp('/settings');
  await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
  return screen.getByRole('form', { name: 'Change password' });
};
const fill = async (form: HTMLElement, cur: string, next: string, again: string) => {
  const type = async (name: string, v: string) => { if (v) await userEvent.type(within(form).getByLabelText(name, { selector: 'input' }), v); };
  await type('Current password', cur);
  await type('New password', next);
  await type('Confirm new password', again);
};
const submit = () => userEvent.click(screen.getByRole('form', { name: 'Change password' }).querySelector('button[type=submit]')!);

describe('Settings → Account → Change password', () => {
  it('posts both passwords, says how many other devices were signed out, and closes', async () => {
    const calls = mockApi(makeMe(), { 'POST /api/auth/password': { body: { ok: true, signedOutOthers: 2 } } });
    const form = await open();
    expect(within(form).getByText(/signs you out on your other devices/i)).toBeInTheDocument();
    await fill(form, 'old password', 'brand new pass', 'brand new pass');
    await submit();
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed. 2 other devices were signed out.');
    expect(calls.find((c) => c.path === '/api/auth/password')?.body).toEqual({ currentPassword: 'old password', newPassword: 'brand new pass' });
    expect(screen.queryByRole('form', { name: 'Change password' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change password' })).toHaveFocus());
  });

  it('says so when no other device was signed in (and in the singular)', async () => {
    mockApi(makeMe(), { 'POST /api/auth/password': { body: { ok: true, signedOutOthers: 1 } } });
    const form = await open();
    await fill(form, 'old password', 'brand new pass', 'brand new pass');
    await submit();
    expect(await screen.findByRole('status')).toHaveTextContent('1 other device was signed out.');
  });

  it.each([
    ['no current password', '', 'brand new pass', 'brand new pass', 'Enter your current password.', 'Current password'],
    ['too short', 'old password', 'short', 'short', 'Use 8–128 characters for the new password.', 'New password'],
    ['mismatch', 'old password', 'brand new pass', 'brand new pasx', "The two new passwords don't match.", 'Confirm new password'],
    ['same as current', 'old password', 'old password', 'old password', 'Choose a password you are not using now.', 'New password'],
  ])('%s: a clear error, no request, focus on the field', async (_n, cur, next, again, text, field) => {
    const calls = mockApi(makeMe());
    const form = await open();
    await fill(form, cur, next, again);
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    const input = within(form).getByLabelText(field, { selector: 'input' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
    expect(calls.some((c) => c.path === '/api/auth/password')).toBe(false);
  });

  it('a wrong current password clears that box and focuses it; the new ones stay', async () => {
    mockApi(makeMe(), { 'POST /api/auth/password': { status: 401, body: { error: 'bad_credentials' } } });
    const form = await open();
    await fill(form, 'nope nope', 'brand new pass', 'brand new pass');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent("That isn't your current password.");
    const cur = within(form).getByLabelText('Current password', { selector: 'input' });
    expect(cur).toHaveValue('');
    await waitFor(() => expect(cur).toHaveFocus());
    expect(within(form).getByLabelText('New password', { selector: 'input' })).toHaveValue('brand new pass');
  });

  it('too many tries and offline each get plain words', async () => {
    mockApi(makeMe(), { 'POST /api/auth/password': { status: 429, body: { error: 'too_many_attempts' } } });
    const form = await open();
    await fill(form, 'old password', 'brand new pass', 'brand new pass');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Wait 15 minutes and try again.');
  });

  it('Show password reveals a field; Cancel closes without a request', async () => {
    const calls = mockApi(makeMe());
    const form = await open();
    const cur = within(form).getByLabelText('Current password', { selector: 'input' });
    expect(cur).toHaveAttribute('autocomplete', 'current-password');
    expect(within(form).getByLabelText('New password', { selector: 'input' })).toHaveAttribute('autocomplete', 'new-password');
    expect(cur).toHaveAttribute('type', 'password');
    await userEvent.click(within(form).getAllByRole('button', { name: 'Show password' })[0]!);
    expect(cur).toHaveAttribute('type', 'text');
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Change password' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/auth/password')).toBe(false);
  });
});
