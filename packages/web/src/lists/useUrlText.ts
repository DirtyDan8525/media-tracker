import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * A search box's text, kept in the URL query param `key`. The box keeps its own text (no dropped
 * characters or caret jumps); the URL follows `delayMs` later, by `replace`. Back / reload (a URL
 * change that isn't ours) puts the new value in the box. Other params are left alone.
 *
 * A write still waiting when the person taps or presses Enter somewhere (a fast tap away to a title)
 * is flushed first, so Back returns to the text they had typed. It is not flushed from the unmount
 * itself: by then the route has changed, and a navigation made there would replace the new page.
 */
export function useUrlText(key: string, delayMs = 150): { text: string; setText: (v: string) => void; clear: () => void } {
  const [params, setParams] = useSearchParams();
  const urlText = params.get(key) ?? '';
  const [text, setLocal] = useState(urlText);
  const lastWritten = useRef(urlText);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (urlText !== lastWritten.current) { lastWritten.current = urlText; setLocal(urlText); }
  }, [urlText]);

  const write = useCallback((v: string) => {
    lastWritten.current = v;
    setParamsRef.current((prev) => {
      const p = new URLSearchParams(prev);
      if (v) p.set(key, v);
      else p.delete(key);
      return p;
    }, { replace: true });
  }, [key]);

  const flush = useCallback(() => {
    if (pending.current === null) return;
    clearTimeout(timer.current);
    const v = pending.current;
    pending.current = null;
    write(v);
  }, [write]);

  // Capture phase: runs before the tap's click (or Enter's activation) navigates away.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') flush(); };
    document.addEventListener('pointerdown', flush, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', flush, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [flush]);

  const setText = useCallback((v: string) => {
    setLocal(v);
    clearTimeout(timer.current);
    if (v === '') { pending.current = null; write(''); }
    else {
      pending.current = v;
      timer.current = setTimeout(() => { pending.current = null; write(v); }, delayMs);
    }
  }, [write, delayMs]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
    setLocal('');
    write('');
  }, [write]);

  return { text, setText, clear };
}
