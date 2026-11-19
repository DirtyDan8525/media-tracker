import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

const ren = { id: 'id-ren', username: 'ren', avatarAt: '2026-11-01T00:00:00Z' };

describe('Avatar with viewable', () => {
  it('a photo opens full screen from a named 44px-target button; the image is the same URL', async () => {
    render(<Avatar user={ren} size={96} viewable name="Ren" />);
    await userEvent.click(screen.getByRole('button', { name: 'View Ren\'s profile picture' }));
    const dialog = screen.getByRole('dialog', { name: 'Ren\'s profile picture' });
    expect(dialog).toBeInTheDocument();
    const big = dialog.querySelector('img')!;
    expect(big.getAttribute('src')).toBe('/api/users/id-ren/avatar?v=2026-11-01T00%3A00%3A00Z');
  });

  it('Close and Escape close it, and focus goes back to the picture', async () => {
    render(<Avatar user={ren} size={96} viewable name="Ren" />);
    const open = screen.getByRole('button', { name: 'View Ren\'s profile picture' });
    await userEvent.click(open);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    await userEvent.click(open);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('no photo: no button, so no viewer', () => {
    render(<Avatar user={{ ...ren, avatarAt: null }} size={96} viewable name="Ren" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('without viewable it stays a plain picture', () => {
    render(<Avatar user={ren} size={44} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('your own picture says "your"', async () => {
    render(<Avatar me={{ username: 'dan', email: 'd@x.co', avatarAt: '2026-11-02T00:00:00Z' }} size={96} viewable />);
    await userEvent.click(screen.getByRole('button', { name: 'View your profile picture' }));
    expect(screen.getByRole('dialog', { name: 'Your profile picture' })).toBeInTheDocument();
  });
});
