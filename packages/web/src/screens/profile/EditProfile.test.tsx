import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend } from '../../test/fakeBackend';
import { friendsOf, makeFriendEntry, REN } from '../../test/friends';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const bioBackend = (me = makeMe({ bio: 'professional anime enjoyer 🍜\nwill fight you over Frieren', displayName: 'Dan' }), extra: Record<string, unknown> = {}) => {
  let current = me;
  return fakeBackend({
    me: current,
    extra: {
      'GET /api/me': () => ({ body: current }),
      'PUT /api/me/bio': (b: unknown) => {
        const bio = String((b as { bio: string }).bio);
        if (/https?:/.test(bio)) return { status: 400, body: { error: 'no_links' } };
        current = { ...current, bio: bio.trim() === '' ? null : bio.trim() };
        return { body: current };
      },
      'PUT /api/me/display-name': (b: unknown) => {
        current = { ...current, displayName: (b as { displayName: string | null }).displayName };
        return { body: current };
      },
      ...extra,
    } as never,
  });
};

const openSheet = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
  return screen.findByRole('dialog', { name: 'Edit profile' });
};

describe('your profile: bio', () => {
  it('shows the name, @username and the bio with its line breaks under it', async () => {
    bioBackend();
    renderApp('/profile');
    expect(await screen.findByText('@dan')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Dan' })).toBeInTheDocument();
    const bio = screen.getByText(/professional anime enjoyer/);
    expect(bio.textContent).toBe('professional anime enjoyer 🍜\nwill fight you over Frieren');
  });

  it('no bio: nothing extra shows but the Edit profile button is there', async () => {
    bioBackend(makeMe());
    renderApp('/profile');
    expect(await screen.findByRole('button', { name: 'Edit profile' })).toBeInTheDocument();
    expect(document.querySelector('.profile__bio')).toBeNull();
  });

  it('Edit profile: fields start filled, the counter counts, Save sends the bio and the sheet closes', async () => {
    const { calls } = bioBackend(makeMe());
    renderApp('/profile');
    const sheet = await openSheet();
    expect(within(sheet).getByRole('textbox', { name: 'Display name' })).toHaveValue('');
    const bio = within(sheet).getByRole('textbox', { name: 'Bio' });
    expect(within(sheet).getByText('0 / 150')).toBeInTheDocument();
    await userEvent.type(bio, 'hello 🍜{Enter}world');
    expect(within(sheet).getByText('13 / 150')).toBeInTheDocument();
    expect(within(sheet).getByText('Line breaks and emoji are fine. No links.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'PUT' && c.path === '/api/me/bio')?.body).toEqual({ bio: 'hello 🍜\nworld' });
    expect(calls.some((c) => c.path === '/api/me/display-name')).toBe(false); // unchanged: not sent
    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
    expect(document.querySelector('.profile__bio')?.textContent).toBe('hello 🍜\nworld');
  });

  it('saves the display name too, and clearing the bio sends an empty bio', async () => {
    const { calls } = bioBackend();
    renderApp('/profile');
    const sheet = await openSheet();
    const name = within(sheet).getByRole('textbox', { name: 'Display name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Danny');
    await userEvent.clear(within(sheet).getByRole('textbox', { name: 'Bio' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.find((c) => c.path === '/api/me/display-name')?.body).toEqual({ displayName: 'Danny' });
    expect(calls.find((c) => c.path === '/api/me/bio')?.body).toEqual({ bio: '' });
    expect(document.querySelector('.profile__bio')).toBeNull();
  });

  it('over 150 characters, 5 lines or a link: says so and Save is off', async () => {
    bioBackend(makeMe());
    renderApp('/profile');
    const sheet = await openSheet();
    const bio = within(sheet).getByRole('textbox', { name: 'Bio' });
    const save = within(sheet).getByRole('button', { name: 'Save' });
    await userEvent.type(bio, 'a'.repeat(151));
    expect(within(sheet).getByText('151 / 150')).toBeInTheDocument();
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Keep it to 150 characters.');
    expect(save).toBeDisabled();
    await userEvent.clear(bio);
    await userEvent.type(bio, 'a{Enter}b{Enter}c{Enter}d{Enter}e');
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Up to 4 lines.');
    expect(save).toBeDisabled();
    await userEvent.clear(bio);
    await userEvent.type(bio, 'see example.com');
    expect(within(sheet).getByRole('alert')).toHaveTextContent("Bios can't have links.");
    expect(save).toBeDisabled();
    await userEvent.clear(bio);
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it('a server no_links answer shows inline and keeps the sheet open', async () => {
    // the client check does not know this one (the server is stricter), so the PUT goes out and fails
    bioBackend(makeMe(), { 'PUT /api/me/bio': { status: 400, body: { error: 'no_links' } } });
    renderApp('/profile');
    const sheet = await openSheet();
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Bio' }), 'plain words');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent("Bios can't have links.");
    expect(screen.getByRole('dialog', { name: 'Edit profile' })).toBeInTheDocument();
  });

  it('a network failure says so', async () => {
    bioBackend(makeMe(), { 'PUT /api/me/bio': { status: 500, body: { error: 'boom' } } });
    renderApp('/profile');
    const sheet = await openSheet();
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Bio' }), 'hi');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn't save your bio");
  });
});

describe("a friend's profile: bio", () => {
  const profile = (bio: string | null) => fakeBackend({
    me: makeMe(),
    extra: {
      'GET /api/users/:username': { body: { user: REN, memberSince: '2026-10-01T00:00:00Z', bio, relation: 'friend' } },
      'GET /api/users/:username/entries': { body: [makeFriendEntry({ title: 'Frieren', rating: 9 })] },
      'GET /api/friends': { body: friendsOf(REN) },
    } as never,
  });

  it('shows it under their name', async () => {
    profile('rewatching Frieren\nagain');
    renderApp('/u/ren');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ren' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.friend-id__bio')?.textContent).toBe('rewatching Frieren\nagain'));
  });

  it('shows nothing when they have none', async () => {
    profile(null);
    renderApp('/u/ren');
    await screen.findByRole('heading', { level: 1, name: 'Ren' });
    expect(document.querySelector('.friend-id__bio')).toBeNull();
  });
});
