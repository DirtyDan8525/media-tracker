import type { PostSocial } from '@media-tracker/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReactionBar } from './ReactionBar';

const social: PostSocial = { reactions: { '❤️': 3, '🔥': 1 }, mine: ['🔥'], comments: 0 };

describe('ReactionBar', () => {
  it('shows the six reactions in a named group, counts only where someone reacted, aria-pressed for yours', () => {
    render(<ReactionBar social={social} onToggle={() => {}} />);
    const group = screen.getByRole('group', { name: 'Reactions' });
    expect(group.querySelectorAll('button')).toHaveLength(6);
    expect(screen.getByRole('button', { name: '❤️ 3' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '🔥 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '😂' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle with the emoji', async () => {
    const onToggle = vi.fn();
    render(<ReactionBar social={social} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: '😮' }));
    expect(onToggle).toHaveBeenCalledWith('😮');
  });
});
