import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  scrollTo = vi.fn();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});
afterEach(() => { setViewportWidth(390); });

/** Pretend the person asked for reduced motion. */
function reduceMotion() {
  const real = window.matchMedia;
  window.matchMedia = ((q: string) => (/prefers-reduced-motion:\s*reduce/.test(q) ? ({ ...real(q), matches: true } as MediaQueryList) : real(q))) as typeof window.matchMedia;
  return () => { window.matchMedia = real; };
}

describe('tapping Home on a list (phone)', () => {
  it('scrolls to the top, smoothly, and stays on the list', async () => {
    fakeBackend();
    const { router } = renderApp('/list/movies');
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    await userEvent.click(within(bar).getByRole('link', { name: 'Home' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(router.state.location.pathname).toBe('/list/movies');
  });

  it('jumps instead of gliding under reduced motion', async () => {
    const restore = reduceMotion();
    try {
      fakeBackend();
      renderApp('/list/movies');
      const bar = await screen.findByRole('navigation', { name: 'Main' });
      await userEvent.click(within(bar).getByRole('link', { name: 'Home' }));
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    } finally { restore(); }
  });

  it('on another screen it navigates as usual and does not scroll', async () => {
    localStorage.setItem('mt-current-list', 'books');
    fakeBackend();
    const { router } = renderApp('/more');
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    await userEvent.click(within(bar).getByRole('link', { name: 'Home' }));
    expect(scrollTo).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/list/books'));
  });
});

describe('tapping a list row in the side nav (PC)', () => {
  beforeEach(() => setViewportWidth(1280));

  it('the row for the list on screen scrolls to the top', async () => {
    fakeBackend();
    const { router } = renderApp('/list/movies');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await userEvent.click(within(nav).getByRole('link', { name: /^Movies/ }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(router.state.location.pathname).toBe('/list/movies');
  });

  it('another list navigates there without scrolling', async () => {
    fakeBackend();
    const { router } = renderApp('/list/movies');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await userEvent.click(within(nav).getByRole('link', { name: /^Books/ }));
    expect(scrollTo).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/list/books'));
  });

  it('Home on a list scrolls too; Home elsewhere navigates', async () => {
    localStorage.setItem('mt-current-list', 'books');
    fakeBackend();
    const { router } = renderApp('/list/books');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Home' }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    await userEvent.click(within(nav).getByRole('link', { name: 'Home' }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/list/books'));
  });
});
