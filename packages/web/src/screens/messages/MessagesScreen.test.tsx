import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeBackend } from '../../test/fakeBackend';
import { friendsOf, REN } from '../../test/friends';
import { ALBERTO, FRIEREN_REC, makeConversation, makeMessage, makeSummary, messagesBackend, ME, REN_U } from '../../test/messagesBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

function setup(over: Parameters<typeof messagesBackend>[0] = {}, extra: Record<string, unknown> = {}) {
  const b = messagesBackend(over);
  fakeBackend({ me: makeMe(), extra: { ...b.handlers, 'GET /api/friends': { body: friendsOf(REN) }, ...extra } as never });
  return b;
}

describe('Messages list', () => {
  it('lists chats newest first with the other person, a preview and who sent it; an unread chat is marked', async () => {
    const group = makeConversation({ id: 'c2', kind: 'group', name: 'Anime night', members: [ME, REN_U, ALBERTO] });
    const b = setup({
      conversations: [makeConversation(), group],
      messages: {
        c1: [makeMessage({ conversationId: 'c1', senderId: ME.id, text: 'see you friday!' })],
        c2: [makeMessage({ conversationId: 'c2', senderId: REN_U.id, kind: 'rec', text: '', rec: FRIEREN_REC })],
      },
    });
    b.state.unread = 1;
    renderApp('/messages');
    const list = await screen.findByRole('list', { name: 'Chats' });
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('href', '/messages/c1');
    expect(rows[0]).toHaveTextContent('Ren');
    expect(rows[0]).toHaveTextContent('You: see you friday!');
    expect(rows[1]).toHaveAttribute('href', '/messages/c2');
    expect(rows[1]).toHaveTextContent('Anime night');
    expect(rows[1]).toHaveTextContent('Ren: Recommended a title');
  });

  it('shows a picture as "Photo" and a deleted message as "Message deleted"', async () => {
    const b = setup({
      conversations: [makeConversation(), makeConversation({ id: 'c2', members: [ME, ALBERTO] })],
      messages: {
        c1: [makeMessage({ conversationId: 'c1', kind: 'image', text: '', image: true })],
        c2: [makeMessage({ conversationId: 'c2', senderId: ALBERTO.id, deleted: true, text: '' })],
      },
    });
    expect(b.conversations).toHaveLength(2);
    renderApp('/messages');
    const rows = within(await screen.findByRole('list', { name: 'Chats' })).getAllByRole('link');
    expect(rows[0]).toHaveTextContent('📷 Photo');
    expect(rows[1]).toHaveTextContent('Message deleted');
  });

  it('marks an unread chat in its accessible name', async () => {
    const summary = makeSummary({ unread: true, last: { kind: 'text', text: 'yo', senderId: REN_U.id, deleted: false, createdAt: new Date().toISOString() } });
    setup({}, { 'GET /api/conversations': { body: { conversations: [summary] } } });
    renderApp('/messages');
    expect(await screen.findByRole('link', { name: /^Ren, unread\./ })).toBeInTheDocument();
  });

  it('empty: "No messages yet" with a Message a friend action; New and Recommended to you are always there', async () => {
    setup({ conversations: [] });
    renderApp('/messages');
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Message a friend' })).toHaveAttribute('href', '/messages/new');
    expect(screen.getByRole('link', { name: 'New' })).toHaveAttribute('href', '/messages/new');
    expect(screen.getByRole('link', { name: /^Recommended to you/ })).toHaveAttribute('href', '/messages/recommended');
  });

  it('Recommended to you shows how many recs came', async () => {
    setup({ recommended: [{ message: makeMessage({ kind: 'rec', rec: FRIEREN_REC }), sender: REN_U }] });
    renderApp('/messages');
    expect(await screen.findByRole('link', { name: 'Recommended to you · 1' })).toBeInTheDocument();
  });

  it('says so, with Retry, when the list cannot load', async () => {
    setup({}, { 'GET /api/conversations': { status: 500, body: {} } });
    renderApp('/messages');
    expect(await screen.findByText("Couldn't load your messages")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
