import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { ALBERTO, FRIEREN_REC, makeMessage, messagesBackend, REN_U } from '../../test/messagesBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

function setup(recommended: Parameters<typeof messagesBackend>[0] extends infer O ? NonNullable<O extends { recommended?: infer R } ? R : never> : never, entries = [] as ReturnType<typeof makeEntry>[]) {
  const b = messagesBackend({ recommended });
  const { calls } = fakeBackend({ me: makeMe(), entries, extra: b.handlers as never });
  return { calls };
}
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

describe('Recommended to you', () => {
  it('lists recs newest first with who sent them and how long ago; Add to mine or "On your list"', async () => {
    const book = { category: 'books' as const, title: 'Piranesi', creator: 'Susanna Clarke', coverUrl: '', rating: 9.5, source: null, sourceId: null };
    const { calls } = setup([
      { message: makeMessage({ id: 'r1', kind: 'rec', rec: FRIEREN_REC, text: 'you HAVE to watch this', createdAt: daysAgo(2) }), sender: REN_U },
      { message: makeMessage({ id: 'r2', kind: 'rec', rec: book, text: '', createdAt: daysAgo(8) }), sender: ALBERTO },
    ], [makeEntry({ id: 'mine', category: 'books', title: 'Piranesi', creator: 'Susanna Clarke' })]);
    renderApp('/messages/recommended');
    const list = await screen.findByRole('list', { name: 'Recommended to you' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('from @ren · 2 d');
    expect(items[1]).toHaveTextContent('from @alberto · 1 w');
    expect(within(items[0]!).getByText('“you HAVE to watch this”')).toBeInTheDocument();
    expect(await within(items[1]!).findByRole('link', { name: 'On your list' })).toHaveAttribute('href', '/entry/mine');
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Add to mine' }));
    expect(await within(items[0]!).findByRole('link', { name: 'On your list' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/entries')?.body).toMatchObject({ title: 'Frieren', status: 'Plan to watch' });
  });

  it('empty state', async () => {
    setup([]);
    renderApp('/messages/recommended');
    expect(await screen.findByText('Nothing recommended yet')).toBeInTheDocument();
  });
});
