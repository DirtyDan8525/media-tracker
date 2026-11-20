import { useEffect } from 'react';

/**
 * Phone keyboard handling (Dan, 2026-11-20: in a chat the keyboard pushed the bottom bar up above
 * it, the message box floated above that, and the page could scroll past the bottom).
 *
 * - While a text field has focus on a touch screen, `<html>` gets the class `kbd-open`; CSS hides
 *   the bottom bar and the Add bubble then, so nothing rides up on the keyboard.
 * - `--vv-h` / `--vv-top` follow the visual viewport (the part of the page not under the
 *   keyboard), so a full-screen layer like the open chat can sit exactly above the keyboard on
 *   every browser, whether the keyboard resizes the page or only overlays it.
 */
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

export function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type);
}

export function useKeyboardLayout(): void {
  useEffect(() => {
    const root = document.documentElement;
    const coarse = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const sync = () => {
      const open = coarse() && isTextField(document.activeElement);
      root.classList.toggle('kbd-open', open);
    };
    const onFocusOut = () => { window.setTimeout(sync, 0); }; // focus may move to another field
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', onFocusOut);

    const vv = window.visualViewport;
    const setVv = () => {
      if (!vv) return;
      root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    };
    setVv();
    vv?.addEventListener('resize', setVv);
    vv?.addEventListener('scroll', setVv);
    sync();
    return () => {
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', onFocusOut);
      vv?.removeEventListener('resize', setVv);
      vv?.removeEventListener('scroll', setVv);
      root.classList.remove('kbd-open');
      root.style.removeProperty('--vv-h');
      root.style.removeProperty('--vv-top');
    };
  }, []);
}
