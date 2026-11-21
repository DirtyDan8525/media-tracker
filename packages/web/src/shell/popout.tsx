import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';

/** True inside the chat pop-out window (AppFrame sets it when the URL has ?popout=1). */
export const PopoutContext = createContext(false);
export const usePopout = (): boolean => useContext(PopoutContext);

/** Opens a chat in its own small window. The window name is per chat, so a second click focuses the one already open. Returns false if the browser blocked it. */
export function openChatPopout(id: string): boolean {
  const w = window.open(`/messages/${encodeURIComponent(id)}?popout=1`, `chat-${id}`, 'popup,width=420,height=680');
  if (!w) return false;
  w.focus?.();
  return true;
}

/** Shows an in-app path in the main window (the opener when it is still open and ours), else in a new tab. */
export function openInMainWindow(href: string): void {
  try {
    const opener = window.opener as Window | null;
    if (opener && !opener.closed && opener.location.origin === window.location.origin) {
      opener.location.assign(href);
      opener.focus();
      return;
    }
  } catch { /* cross-origin opener: fall through */ }
  window.open(href, '_blank');
}

/** Inside the pop-out, links to other pages open in the main window instead of navigating the pop-out. */
export function PopoutLinks({ children }: { children: ReactNode }) {
  const onClickCapture = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    e.preventDefault();
    e.stopPropagation();
    openInMainWindow(url.pathname + url.search + url.hash);
  };
  return <div className="popout-links" onClickCapture={onClickCapture}>{children}</div>;
}
