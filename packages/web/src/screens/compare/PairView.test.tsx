import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompareItem, Question } from '@media-tracker/shared';
import { describe, expect, it, vi } from 'vitest';
import { PairView } from './PairView';

const item = (id: string, rating: number | null): CompareItem => ({ id, title: id, rating, cover: '', square: false });
const X = item('X', 8.25), Y = item('Y', null);
const q: Question = { a: X, b: Y, title: 'Rating Y (Anime)', progress: 'Unrated 1 of 2' };

function renderPair(over: Partial<Parameters<typeof PairView>[0]> = {}) {
  const onAnswer = vi.fn(), onBack = vi.fn();
  render(<PairView question={q} left={Y} right={X} canBack onAnswer={onAnswer} onBack={onBack} wide={false} {...over} />);
  return { onAnswer, onBack };
}

describe('PairView', () => {
  it('shows the title, the phone sub-line and each card’s rating line', () => {
    renderPair();
    expect(screen.getByRole('heading', { name: 'Rating Y (Anime)' })).toBeInTheDocument();
    expect(screen.getByText('Which one do you think is better? Tap it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Y, not rated yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'X, now 8.25' })).toBeInTheDocument();
    expect(screen.getByText('Unrated 1 of 2')).toBeInTheDocument();
    expect(screen.queryByText(/^Keyboard:/)).not.toBeInTheDocument();
  });

  it('PC: "Click it." and the keyboard hint', () => {
    renderPair({ wide: true });
    expect(screen.getByText('Which one do you think is better? Click it.')).toBeInTheDocument();
    expect(screen.getByText(/^Keyboard:/)).toHaveTextContent('Keyboard: ← left · → right · ↓ same · S skip · Backspace back');
  });

  it('maps the flipped cards back to the question: left (= b) answers "b", right (= a) answers "a"', async () => {
    const { onAnswer } = renderPair();
    await userEvent.click(screen.getByRole('button', { name: 'Y, not rated yet' }));
    expect(onAnswer).toHaveBeenLastCalledWith('b');
    await userEvent.click(screen.getByRole('button', { name: 'X, now 8.25' }));
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
    const card = screen.getByRole('button', { name: 'X, now 8.25' });
    fireEvent.pointerDown(card, { clientX: 300, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.click(card);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenLastCalledWith('b'); // swiped toward the left card
  });
});
