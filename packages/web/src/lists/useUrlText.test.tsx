import { act, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUrlText } from './useUrlText';

let api: ReturnType<typeof useUrlText>;
let search = '';
function Probe() {
  api = useUrlText('q', 150);
  search = useLocation().search;
  return null;
}
const mount = () => render(<MemoryRouter initialEntries={['/search']}><Probe /></MemoryRouter>);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useUrlText', () => {
  it('the URL follows the box 150 ms after the last keystroke', () => {
    mount();
    act(() => api.setText('fri'));
    expect(search).toBe('');
    act(() => { vi.advanceTimersByTime(149); });
    expect(search).toBe('');
    act(() => { vi.advanceTimersByTime(1); });
    expect(search).toBe('?q=fri');
  });

  it('a tap (pointerdown) before the 150 ms flushes the pending text, once', () => {
    mount();
    act(() => api.setText('fri'));
    act(() => { document.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(search).toBe('?q=fri');
    act(() => { vi.advanceTimersByTime(500); });
    expect(search).toBe('?q=fri');
  });

  it('Enter flushes; another key does not', () => {
    mount();
    act(() => api.setText('bl'));
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
    expect(search).toBe('');
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(search).toBe('?q=bl');
  });

  it('with nothing pending a tap writes nothing, and clear() leaves nothing to flush', () => {
    mount();
    act(() => { document.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(search).toBe('');
    act(() => api.setText('x'));
    act(() => api.clear());
    act(() => { document.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(search).toBe('');
  });

  it('unmounting drops a pending write instead of navigating from a gone screen', () => {
    const { unmount } = mount();
    act(() => api.setText('fri'));
    unmount();
    act(() => { vi.advanceTimersByTime(500); });
    expect(search).toBe('');
  });
});
