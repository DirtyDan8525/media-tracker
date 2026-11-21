import type { Comment } from '@media-tracker/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../design/components/Toast';
import { publicSettings } from '../../test/appSettings';
import { mockFetch } from '../../test/mockApi';
import { makeQueryClient } from '../../test/queryClient';
import { CommentsSheet } from './CommentsSheet';

vi.mock('../messages/resizeImage', () => ({ resizeImage: vi.fn(async () => new Blob([new Uint8Array(20)], { type: 'image/jpeg' })) }));

const ren = { id: 'u-ren', username: 'ren', displayName: 'Ren', avatarAt: null };
const comment = (over: Partial<Comment> = {}): Comment => ({ id: 'c1', author: ren, body: 'Great pick', image: false, expired: false, createdAt: '2026-11-15T10:00:00.000Z', canDelete: false, ...over });

function setup(handlers: Parameters<typeof mockFetch>[0]) {
  const calls = mockFetch(handlers);
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <ToastProvider><CommentsSheet target={{ activityId: 'p1', entryId: 'e1' }} open onClose={() => {}} /></ToastProvider>
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

  describe('pictures', () => {
    const app = (media: boolean, photos = true) => ({ 'GET /api/app': { body: { ...publicSettings({ features: { photos } }), media } } });
    const png = () => new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });

    it('the photo button shows only when the server has storage and Photos is on', async () => {
      setup({ 'GET /api/comments': { body: [] }, ...app(false) });
      await screen.findByText('No comments yet. Say something kind.');
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByRole('button', { name: 'Add a photo or GIF' })).not.toBeInTheDocument();
    });

    it('is hidden when the Photos switch is off', async () => {
      setup({ 'GET /api/comments': { body: [] }, ...app(true, false) });
      await screen.findByText('No comments yet. Say something kind.');
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByRole('button', { name: 'Add a photo or GIF' })).not.toBeInTheDocument();
    });

    it('stage, remove with ✕, stage again, then Post uploads then posts a picture-only comment', async () => {
      const calls = setup({
        'GET /api/comments': { body: [] }, ...app(true),
        'POST /api/comments/media': { status: 201, body: { mediaId: 'a'.repeat(32) } },
        'POST /api/comments': () => ({ status: 201, body: comment({ id: 'c9', body: '', image: true, canDelete: true }) }),
      });
      const add = await screen.findByRole('button', { name: 'Add a photo or GIF' });
      const post = screen.getByRole('button', { name: 'Post' });
      expect(post).toBeDisabled();
      const input = screen.getByTestId('comment-photo-input');
      fireEvent.change(input, { target: { files: [png()] } });
      expect(await screen.findByRole('img', { name: 'Photo to send' })).toBeInTheDocument();
      expect(post).toBeEnabled(); // text is optional with a picture
      await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
      expect(screen.queryByRole('img', { name: 'Photo to send' })).not.toBeInTheDocument();
      expect(post).toBeDisabled();
      expect(add).toBeInTheDocument();
      fireEvent.change(input, { target: { files: [png()] } });
      await screen.findByRole('img', { name: 'Photo to send' });
      await userEvent.click(post);
      await waitFor(() => expect(screen.queryByRole('img', { name: 'Photo to send' })).not.toBeInTheDocument());
      const up = calls.find((c) => c.method === 'POST' && c.path.startsWith('/api/comments/media'))!;
      expect(up.path).toBe('/api/comments/media?activityId=p1');
      expect((up.init!.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/comments')!.body).toEqual({ activityId: 'p1', mediaId: 'a'.repeat(32) });
      expect(await screen.findByRole('img', { name: 'Picture from Ren' })).toHaveAttribute('src', '/api/comments/c9/media');
    });

    it('a GIF goes as it is, with the text', async () => {
      const calls = setup({
        'GET /api/comments': { body: [] }, ...app(true),
        'POST /api/comments/media': { status: 201, body: { mediaId: 'b'.repeat(32) } },
        'POST /api/comments': { status: 201, body: comment({ id: 'c8', body: 'lol', image: true, canDelete: true }) },
      });
      await screen.findByRole('button', { name: 'Add a photo or GIF' });
      const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4])], 'x.gif', { type: 'image/gif' });
      fireEvent.change(screen.getByTestId('comment-photo-input'), { target: { files: [gif] } });
      await screen.findByRole('img', { name: 'Photo to send' });
      await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'lol');
      await userEvent.click(screen.getByRole('button', { name: 'Post' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/comments')).toBe(true));
      expect((calls.find((c) => c.path.startsWith('/api/comments/media'))!.init!.headers as Record<string, string>)['content-type']).toBe('image/gif');
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/comments')!.body).toEqual({ activityId: 'p1', body: 'lol', mediaId: 'b'.repeat(32) });
    });

    it('a refused upload says so and keeps the picture staged', async () => {
      setup({ 'GET /api/comments': { body: [] }, ...app(true), 'POST /api/comments/media': { status: 413, body: { error: 'too_large' } } });
      await screen.findByRole('button', { name: 'Add a photo or GIF' });
      fireEvent.change(screen.getByTestId('comment-photo-input'), { target: { files: [png()] } });
      await screen.findByRole('img', { name: 'Photo to send' });
      await userEvent.click(screen.getByRole('button', { name: 'Post' }));
      expect(await screen.findByText('That photo is too big to send.')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Photo to send' })).toBeInTheDocument();
    });

    it('a comment with a picture shows it under the text; tapping opens it full size', async () => {
      setup({ 'GET /api/comments': { body: [comment({ id: 'c5', image: true })] } });
      const img = await screen.findByRole('img', { name: 'Picture from Ren' });
      expect(img).toHaveAttribute('src', '/api/comments/c5/media');
      expect(screen.getByText('Great pick')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Open picture from Ren full size' }));
      expect(await screen.findByRole('img', { name: 'Picture from Ren, full size' })).toHaveAttribute('src', '/api/comments/c5/media');
    });

    it('a picture-only comment shows no text, and an expired one reads "Picture expired"', async () => {
      setup({ 'GET /api/comments': { body: [comment({ id: 'c5', body: '', image: true }), comment({ id: 'c6', body: '', expired: true })] } });
      await screen.findByRole('img', { name: 'Picture from Ren' });
      expect(screen.getByText('Picture expired')).toBeInTheDocument();
      expect(screen.getAllByRole('img', { name: /^Picture from Ren$/ })).toHaveLength(1);
      expect(document.querySelectorAll('.comment__body')).toHaveLength(0);
    });
  });
});
