import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTextField, useKeyboardLayout } from './useKeyboardLayout';

function Probe() { useKeyboardLayout(); return <><input aria-label="t" /><input type="checkbox" aria-label="c" /><button>b</button></>; }

const coarse = (on: boolean) => vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
  matches: on && q.includes('coarse'), media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
  addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
}) as unknown as MediaQueryList);

afterEach(() => { vi.restoreAllMocks(); document.documentElement.classList.remove('kbd-open'); });

describe('useKeyboardLayout (phone keyboard, 2026-11-20)', () => {
  it('marks <html> kbd-open while a text field has focus on a touch screen, and clears it after', async () => {
    coarse(true);
    const { getByLabelText, getByText } = render(<Probe />);
    getByLabelText('t').focus();
    expect(document.documentElement.classList.contains('kbd-open')).toBe(true);
    getByText('b').focus();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.classList.contains('kbd-open')).toBe(false);
  });

  it('does nothing with a mouse, or for a checkbox', () => {
    coarse(false);
    const { getByLabelText } = render(<Probe />);
    getByLabelText('t').focus();
    expect(document.documentElement.classList.contains('kbd-open')).toBe(false);
    expect(isTextField(getByLabelText('c'))).toBe(false);
    expect(isTextField(getByLabelText('t'))).toBe(true);
  });
});
