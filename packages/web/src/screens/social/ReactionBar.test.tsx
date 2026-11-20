import type { PostSocial } from '@media-tracker/shared';
import { render as rtlRender, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ME_KEY } from '../../data/useMe';
import { makeMe } from '../../test/mockApi';
import { makeQueryClient } from '../../test/queryClient';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReactButton, ReactionChips } from './ReactionBar';

/** The pickers read your Recent emoji from the signed-in user (the `me` query); seeded here without a server. */
function render(ui: ReactElement, recentEmoji: string[] = []) {
  const qc = makeQueryClient();
  qc.setQueryData(ME_KEY, { ...makeMe(), recentEmoji });
  qc.setQueryDefaults(ME_KEY, { staleTime: Infinity, queryFn: () => qc.getQueryData(ME_KEY) });
  return { qc, ...rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

const social: PostSocial = { reactions: { '❤️': 3, '🔥': 1 }, mine: ['🔥'], comments: 0 };

describe('ReactionChips', () => {
  it('shows a chip only for reactions that exist, aria-pressed for yours', () => {
    render(<ReactionChips social={social} onToggle={() => {}} />);
    const group = screen.getByRole('group', { name: 'Reactions' });
    expect(group.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '❤️ 3' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '🔥 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /😂/ })).not.toBeInTheDocument();
  });

  it('renders nothing when nobody reacted, and shows custom emojis too', () => {
    const { container, rerender } = render(<ReactionChips social={{ reactions: {}, mine: [], comments: 0 }} onToggle={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ReactionChips social={{ reactions: { '🇯🇵': 2 }, mine: [], comments: 0 }} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: '🇯🇵 2' })).toBeInTheDocument();
  });

  it('a tap toggles with the emoji', async () => {
    const onToggle = vi.fn();
    render(<ReactionChips social={social} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: '❤️ 3' }));
    expect(onToggle).toHaveBeenCalledWith('❤️');
  });
});

describe('ReactButton', () => {
  it('opens a popover with the six quick emojis and a "+", picks one, closes and returns focus', async () => {
    const onPick = vi.fn();
    render(<ReactButton mine={['🔥']} onPick={onPick} />);
    const btn = screen.getByRole('button', { name: 'React' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);
    const pop = screen.getByRole('dialog', { name: 'Pick a reaction' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(within(pop).getAllByRole('button')).toHaveLength(7);
    expect(within(pop).getByRole('button', { name: '🔥' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(pop).getByRole('button', { name: '😮' }));
    expect(onPick).toHaveBeenCalledWith('😮');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });

  it('moves focus into the popover, Escape closes it and returns focus, arrows move between emojis', async () => {
    render(<ReactButton mine={[]} onPick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'React' });
    await userEvent.click(btn);
    const pop = screen.getByRole('dialog');
    const first = within(pop).getAllByRole('button')[0];
    expect(first).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(pop).getAllByRole('button')[1]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });

  it('"+" shows "Type any emoji" with Add; one emoji is accepted', async () => {
    const onPick = vi.fn();
    render(<ReactButton mine={[]} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: 'More emojis' }));
    const field = screen.getByRole('textbox', { name: 'Type any emoji' });
    expect(field).toHaveFocus();
    await userEvent.type(field, '🏳️‍🌈');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onPick).toHaveBeenCalledWith('🏳️‍🌈');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['hi', '1', '❤️❤️', ''])('rejects %j with "Just one emoji, please."', async (text) => {
    const onPick = vi.fn();
    render(<ReactButton mine={[]} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: 'More emojis' }));
    const field = screen.getByRole('textbox', { name: 'Type any emoji' });
    if (text) await userEvent.type(field, text);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Just one emoji, please.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Enter in the field adds; Escape in the field closes and returns focus', async () => {
    const onPick = vi.fn();
    render(<ReactButton mine={[]} onPick={onPick} />);
    const btn = screen.getByRole('button', { name: 'React' });
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole('button', { name: 'More emojis' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Type any emoji' }), '🎉{Enter}');
    expect(onPick).toHaveBeenCalledWith('🎉');
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole('button', { name: 'More emojis' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });

  it('a Recent row under the quick set shows your last custom emojis, newest first; hidden when there are none', async () => {
    const onPick = vi.fn();
    render(<ReactButton mine={[]} onPick={onPick} />, ['🦊', '🐸']);
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    const recent = screen.getByRole('group', { name: 'Recent' });
    expect(within(recent).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['🦊', '🐸']);
    // the arrows go from the quick row into the Recent row
    within(screen.getByRole('dialog')).getByRole('button', { name: 'More emojis' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(recent).getByRole('button', { name: '🦊' })).toHaveFocus();
    await userEvent.click(within(recent).getByRole('button', { name: '🐸' }));
    expect(onPick).toHaveBeenCalledWith('🐸');
  });

  it('no Recent row when you have none', async () => {
    render(<ReactButton mine={[]} onPick={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    expect(screen.queryByRole('group', { name: 'Recent' })).not.toBeInTheDocument();
  });

  it('adding a custom emoji puts it at the front of Recent at once (max 4, deduplicated); a quick one does not', async () => {
    const { qc } = render(<ReactButton mine={[]} onPick={() => {}} />, ['🦊', '🐸', '🍜', '🎸']);
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: '❤️' }));
    expect((qc.getQueryData(ME_KEY) as { recentEmoji: string[] }).recentEmoji).toEqual(['🦊', '🐸', '🍜', '🎸']);
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: 'More emojis' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Type any emoji' }), '🌙{Enter}');
    expect((qc.getQueryData(ME_KEY) as { recentEmoji: string[] }).recentEmoji).toEqual(['🌙', '🦊', '🐸', '🍜']);
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Recent' })).getByRole('button', { name: '🍜' }));
    expect((qc.getQueryData(ME_KEY) as { recentEmoji: string[] }).recentEmoji).toEqual(['🍜', '🌙', '🦊', '🐸']);
  });
});
