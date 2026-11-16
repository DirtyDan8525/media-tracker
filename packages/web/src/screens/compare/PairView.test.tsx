import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PairView, type PairItem } from './PairView';

const item = (id: string, rating: number | null, tier: PairItem['tier'] = 3): PairItem => ({ id, title: id, rating, tier, cover: '', square: false });
const X = item('X', 9.25), Y = item('Y', 9.1);
const NAMES = ["Didn't like", 'Fine', 'Liked', 'Loved'];
const RANGES = ['0–5.9', '6–7.4', '7.5–8.9', '9–10'];

function renderPair(over: Partial<Parameters<typeof PairView>[0]> = {}) {
  const onAnswer = vi.fn(), onBack = vi.fn(), onMove = vi.fn();
  render(<PairView heading="Fix my ratings" sub="Anime · Loved" aId="X" left={Y} right={X} progress="Pick 1" canBack
    onAnswer={onAnswer} onBack={onBack} wide={false} tierNames={NAMES} tierRanges={RANGES} onMove={onMove} {...over} />);
  return { onAnswer, onBack, onMove };
}

describe('PairView', () => {
  it('shows the heading, the sub-line, the question and each card’s rating and tier', () => {
    renderPair();
    expect(screen.getByRole('heading', { name: 'Fix my ratings' })).toBeInTheDocument();
    expect(screen.getByText('Anime · Loved')).toBeInTheDocument();
    expect(screen.getByText('Which do you like more? Tap it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Y, now 9.1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'X, now 9.25' })).toBeInTheDocument();
    expect(screen.getAllByText('Tier: Loved')).toHaveLength(2);
    expect(screen.getByText('Pick 1')).toBeInTheDocument();
    expect(screen.queryByText(/^Keyboard:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('PC: "Click it." and the keyboard hint', () => {
    renderPair({ wide: true });
    expect(screen.getByText('Which do you like more? Click it.')).toBeInTheDocument();
    expect(screen.getByText(/^Keyboard:/)).toHaveTextContent('Keyboard: ← left · → right · ↓ same · S skip · Backspace back');
  });

  it('the settledness bar: checked of total; full when there is nothing to check', () => {
    renderPair({ settled: { checked: 18, total: 40 } });
    const bar = screen.getByRole('progressbar', { name: 'Neighbours checked' });
    expect(bar).toHaveAttribute('aria-valuenow', '18');
    expect(bar).toHaveAttribute('aria-valuemax', '40');
    expect(screen.getByText('18 of 40 neighbours checked')).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuetext', '18 of 40 neighbours checked');
  });

  it('settledness 0 of 0: the bar is full and says the same as the text', () => {
    renderPair({ settled: { checked: 0, total: 0 } });
    expect(screen.getByText('0 of 0 neighbours checked')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Neighbours checked' });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '1');
    expect(bar).toHaveAttribute('aria-valuetext', '0 of 0 neighbours checked');
  });

  it('a polite live region announces each new pair', () => {
    const props = { heading: 'Fix my ratings', aId: 'X', canBack: true, onAnswer: vi.fn(), onBack: vi.fn(), onMove: vi.fn(), wide: false, tierNames: NAMES, tierRanges: RANGES };
    const { rerender } = render(<PairView {...props} left={Y} right={X} progress="Pick 1" />);
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Y or X. Pick 1');
    const Z = item('Z', 8);
    rerender(<PairView {...props} left={X} right={Z} progress="Pick 2" />);
    expect(screen.getByRole('status')).toHaveTextContent('X or Z. Pick 2');
  });

  it('maps the flipped cards back to the question: left (= b) answers "b", right (= a) answers "a"', async () => {
    const { onAnswer } = renderPair();
    await userEvent.click(screen.getByRole('button', { name: 'Y, now 9.1' }));
    expect(onAnswer).toHaveBeenLastCalledWith('b');
    await userEvent.click(screen.getByRole('button', { name: 'X, now 9.25' }));
    expect(onAnswer).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onAnswer).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onAnswer).toHaveBeenLastCalledWith('b');
  });

  it('buttons and keys: same, skip, stop, back', async () => {
    const { onAnswer, onBack } = renderPair();
    await userEvent.click(screen.getByRole('button', { name: 'About the same' }));
    expect(onAnswer).toHaveBeenLastCalledWith('same');
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onAnswer).toHaveBeenLastCalledWith('skip');
    await userEvent.click(screen.getByRole('button', { name: 'Stop and review' }));
    expect(onAnswer).toHaveBeenLastCalledWith('stop');
    await userEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(onAnswer).toHaveBeenLastCalledWith('same');
    fireEvent.keyDown(document, { key: 'S' });
    expect(onAnswer).toHaveBeenLastCalledWith('skip');
    const e = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Back is disabled with no history, and Backspace does nothing', () => {
    const { onBack } = renderPair({ canBack: false });
    expect(screen.getByRole('button', { name: '← Back' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Backspace' });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('ignores keys typed in a text field', () => {
    const { onAnswer, onBack } = renderPair();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 's' });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    input.remove();
  });

  it('a swipe that ends on a card does not also count as a tap', () => {
    const { onAnswer } = renderPair();
    const card = screen.getByRole('button', { name: 'X, now 9.25' });
    fireEvent.pointerDown(card, { clientX: 300, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.click(card);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenLastCalledWith('b'); // swiped toward the left card
  });

  it('Belongs in another tier: a sibling of each card that opens the other three tiers', async () => {
    const { onMove, onAnswer } = renderPair();
    const buttons = screen.getAllByRole('button', { name: /^Belongs in another tier/ });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Belongs in another tier: Y', 'Belongs in another tier: X']);
    for (const b of buttons) {
      expect(b.closest('.pick')).toBeNull();
      expect(b).toHaveAttribute('aria-haspopup', 'menu');
    }
    await userEvent.click(buttons[0]!);
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Move Y to' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((m) => m.getAttribute('aria-label'))).toEqual(['Liked · 7.5–8.9', 'Fine · 6–7.4', 'Didn\'t like · 0–5.9']);
    expect(items[0]).toHaveFocus();
    // keys inside the menu move through it; they never answer the question
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1]!, { key: 's' });
    expect(onAnswer).not.toHaveBeenCalled();
    await userEvent.click(items[1]!);
    expect(onMove).toHaveBeenCalledWith('Y', 1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes the menu and focus returns to its button', async () => {
    renderPair();
    const b = screen.getByRole('button', { name: 'Belongs in another tier: X' });
    await userEvent.click(b);
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(b).toHaveFocus();
    expect(b).toHaveAttribute('aria-expanded', 'false');
  });

  it('Tab closes the menu (focus moves on as usual)', async () => {
    renderPair();
    const b = screen.getByRole('button', { name: 'Belongs in another tier: X' });
    await userEvent.click(b);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(b).toHaveAttribute('aria-expanded', 'false');
  });

  it('a press outside the menu closes it; a press on its own button is that button\'s toggle', async () => {
    const { onAnswer } = renderPair();
    const b = screen.getByRole('button', { name: 'Belongs in another tier: X' });
    await userEvent.click(b);
    fireEvent.pointerDown(screen.getByText('Which do you like more? Tap it.'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
    // pressing the opener again toggles it closed once, not closed-then-open
    await userEvent.click(b);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(b);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
