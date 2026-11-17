import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend } from '../../test/fakeBackend';
import { friendsOf, REN } from '../../test/friends';
import { messagesBackend } from '../../test/messagesBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const ALB = { id: 'id-alb', username: 'alberto', displayName: 'Alberto', avatarAt: null };
const VAN = { id: 'id-van', username: 'vance', displayName: 'Vance', avatarAt: null };

function setup(friends = friendsOf(REN, ALB, VAN)) {
  const b = messagesBackend({ conversations: [] });
  const { calls } = fakeBackend({ me: makeMe(), extra: { ...b.handlers, 'GET /api/friends': { body: friends } } as never });
  return { calls, ...b };
}

describe('New chat', () => {
  it('lists your friends as checkboxes; the line says how many are picked', async () => {
    setup();
    renderApp('/messages/new');
    const list = await screen.findByRole('list', { name: 'Your friends' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Start chat' })).toBeDisabled();
    await userEvent.click(within(list).getByRole('checkbox', { name: /Ren/ }));
    expect(screen.getByText('1 picked · direct chat')).toBeInTheDocument();
    // With one friend picked there is no name field.
    expect(screen.queryByLabelText(/Group name/)).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole('checkbox', { name: /Vance/ }));
    expect(screen.getByText('2 picked · group')).toBeInTheDocument();
    expect(screen.getByLabelText(/Group name/)).toBeInTheDocument();
  });

  it('one friend: Start chat opens the direct chat', async () => {
    const { calls } = setup();
    const { router } = renderApp('/messages/new');
    await userEvent.click(await screen.findByRole('checkbox', { name: /Ren/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/messages\/c\d+$/));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/conversations')?.body).toEqual({ userIds: ['id-ren'] });
  });

  it('two or more: Start chat makes a group with the name', async () => {
    const { calls } = setup();
    const { router } = renderApp('/messages/new');
    await userEvent.click(await screen.findByRole('checkbox', { name: /Ren/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Alberto/ }));
    await userEvent.type(screen.getByLabelText(/Group name/), 'Anime night');
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/messages\/c\d+$/));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/conversations')?.body).toEqual({ userIds: ['id-ren', 'id-alb'], name: 'Anime night' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Anime night' })).toBeInTheDocument();
  });

  it('with no friends it points to Friends', async () => {
    setup(friendsOf());
    renderApp('/messages/new');
    expect(await screen.findByText('No friends yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Friends' })).toHaveAttribute('href', '/friends');
  });
});
