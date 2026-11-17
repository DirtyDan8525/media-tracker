import type { Comment } from '@media-tracker/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '../../design/components/Toast';
import { mockFetch } from '../../test/mockApi';
import { makeQueryClient } from '../../test/queryClient';
import { CommentsSheet } from './CommentsSheet';

const ren = { id: 'u-ren', username: 'ren', displayName: 'Ren', avatarAt: null };
const comment = (over: Partial<Comment> = {}): Comment => ({ id: 'c1', author: ren, body: 'Great pick', createdAt: '2026-11-15T10:00:00.000Z', canDelete: false, ...over });

function setup(handlers: Parameters<typeof mockFetch>[0]) {
  const calls = mockFetch(handlers);
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <ToastProvider><CommentsSheet target={{ activityId: 'p1' }} open onClose={() => {}} /></ToastProvider>
    </QueryClientProvider>,
  );
  return calls;
}

describe('CommentsSheet', () => {
  it('lists the thread oldest first and shows an empty note when there is none', async () => {
    setup({ 'GET /api/comments': { body: [comment(), comment({ id: 'c2', body: 'Same!', author: { ...ren, displayName: null } })] } });
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ren');
    expect(items[0]).toHaveTextContent('Great pick');
    expect(items[1]).toHaveTextContent('@ren');
  });

  it('says so when nobody has commented', async () => {
    setup({ 'GET /api/comments': { body: [] } });
    expect(await screen.findByText('No comments yet. Say something kind.')).toBeInTheDocument();
  });

  it('posting shows the comment, the counter reads "480 left", Post is disabled at 0 and over 500', async () => {
    const calls = setup({
      'GET /api/comments': { body: [] },
      'POST /api/comments': (body) => ({ status: 201, body: comment({ id: 'c9', body: (body as { body: string }).body, canDelete: true }) }),
    });
    await screen.findByText('No comments yet. Say something kind.');
    const post = screen.getByRole('button', { name: 'Post' });
    const box = screen.getByRole('textbox', { name: 'Add a comment' });
    expect(post).toBeDisabled();
    expect(screen.getByText('500 left')).toBeInTheDocument();
    await userEvent.type(box, 'x'.repeat(20));
    expect(screen.getByText('480 left')).toBeInTheDocument();
    expect(post).toBeEnabled();
    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste('y'.repeat(501));
    expect(screen.getByText('1 over')).toBeInTheDocument();
    expect(post).toBeDisabled();
    await userEvent.clear(box);
    await userEvent.type(box, 'Same!');
    await userEvent.click(post);
    expect(await screen.findByText('Same!', { selector: 'p' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ activityId: 'p1', body: 'Same!' });
    await waitFor(() => expect(box).toHaveValue(''));
    expect(screen.getByText('500 left')).toBeInTheDocument();
  });

  it('Delete on your own comment asks, then removes it; Keep backs out', async () => {
    const calls = setup({
      'GET /api/comments': { body: [comment({ canDelete: true }), comment({ id: 'c2', body: 'Not mine to delete' })] },
      'DELETE /api/comments/:id': { status: 204 },
    });
    await screen.findByText('Great pick');
    expect(screen.getAllByRole('button', { name: /^Delete comment/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /^Delete comment/ }));
    const ask = screen.getByRole('group', { name: 'Delete this comment?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep' }));
    expect(screen.getByText('Great pick')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Delete comment/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Delete this comment?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Great pick')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/comments/c1')).toBe(true);
    expect(screen.getByText('Not mine to delete')).toBeInTheDocument();
  });

  it('the admin sees Delete on anyone\'s comment (AD7)', async () => {
    setup({
      'GET /api/me': { body: { id: 'u1', username: 'dan', isAdmin: true, settings: {}, email: 'd@x', avatarAt: null, createdAt: null, displayName: null, status: 'active' } },
      'GET /api/comments': { body: [comment({ canDelete: false })] },
      'DELETE /api/comments/:id': { status: 204 },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete comment by Ren' }));
    expect(screen.getByRole('group', { name: 'Delete this comment?' })).toBeInTheDocument();
  });

  it('a member does not see Delete on a comment the server says they cannot delete', async () => {
    setup({ 'GET /api/comments': { body: [comment({ canDelete: false })] } });
    await screen.findByText('Great pick');
    expect(screen.queryByRole('button', { name: /Delete comment by/ })).not.toBeInTheDocument();
  });
});
