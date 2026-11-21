import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../../test/fakeBackend';
import { friendsOf, REN } from '../../test/friends';
import { makeMessage, messagesBackend, REN_U } from '../../test/messagesBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { setCoarsePointer, setViewportWidth } from '../../test/viewport';

function setup() {
  const b = messagesBackend({ messages: { c1: [makeMessage({ senderId: REN_U.id, text: 'hey' })] } });
  fakeBackend({ me: makeMe(), entries: [], extra: { ...b.handlers, 'GET /api/friends': { body: friendsOf(REN) } } as never });
}

beforeEach(() => { setViewportWidth(1280); setCoarsePointer(false); });
afterEach(() => { setViewportWidth(390); setCoarsePointer(false); vi.restoreAllMocks(); document.title = ''; });

describe('Chat pop-out', () => {
  it('PC shows "Pop out chat"; it opens the named popup and returns the main window to Messages', async () => {
    setup();
    const open = vi.spyOn(window, 'open').mockReturnValue({ focus: vi.fn() } as unknown as Window);
    const { router } = renderApp('/messages/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Pop out chat' }));
    expect(open).toHaveBeenCalledWith('/messages/c1?popout=1', 'chat-c1', 'popup,width=420,height=680');
    await waitFor(() => expect(router.state.location.pathname).toBe('/messages'));
  });

  it('is hidden on phones and on touch screens', async () => {
    setup();
    setViewportWidth(390);
    const { unmount } = renderApp('/messages/c1');
    await screen.findByRole('textbox', { name: /Message/ });
    expect(screen.queryByRole('button', { name: 'Pop out chat' })).toBeNull();
    unmount();
    setViewportWidth(1280); setCoarsePointer(true);
    renderApp('/messages/c1');
    await screen.findByRole('textbox', { name: /Message/ });
    expect(screen.queryByRole('button', { name: 'Pop out chat' })).toBeNull();
  });

  it('?popout=1 renders only the chat: no nav, tabs or Add bubble, no pop-out or back button; title is "<Name> · Chat"', async () => {
    setup();
    renderApp('/messages/c1?popout=1');
    await screen.findByRole('textbox', { name: /Message/ });
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(document.querySelector('.bottom-tabs, .side-nav, .add-fab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pop out chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull();
    await waitFor(() => expect(document.title).toBe('Ren · Chat'));
  });

  it('a profile link in the pop-out opens in the opener window, not in the pop-out', async () => {
    setup();
    const opener = { closed: false, location: { origin: window.location.origin, assign: vi.fn() }, focus: vi.fn() };
    Object.defineProperty(window, 'opener', { value: opener, configurable: true });
    try {
      const { router } = renderApp('/messages/c1?popout=1');
      await userEvent.click(await screen.findByRole('link', { name: "Open Ren's profile" }));
      expect(opener.location.assign).toHaveBeenCalledWith('/u/ren');
      expect(opener.focus).toHaveBeenCalled();
      expect(router.state.location.pathname).toBe('/messages/c1');
    } finally {
      Object.defineProperty(window, 'opener', { value: null, configurable: true });
    }
  });

  it('with no opener, the link opens a new tab', async () => {
    setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderApp('/messages/c1?popout=1');
    await userEvent.click(await screen.findByRole('link', { name: "Open Ren's profile" }));
    expect(open).toHaveBeenCalledWith('/u/ren', '_blank');
  });
});
