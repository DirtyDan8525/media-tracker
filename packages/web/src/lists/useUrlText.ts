import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * A search box's text, kept in the URL query param `key`. The box keeps its own text (no dropped
 * characters or caret jumps); the URL follows `delayMs` later, by `replace`. Back / reload (a URL
 * change that isn't ours) puts the new value in the box. Other params are left alone.
 */
export function useUrlText(key: string, delayMs = 150): { text: string; setText: (v: string) => void; clear: () => void } {
  const [params, setParams] = useSearchParams();
  const urlText = params.get(key) ?? '';
  const [text, setLocal] = useState(urlText);
  const lastWritten = useRef(urlText);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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

  const setText = useCallback((v: string) => {
    setLocal(v);
    clearTimeout(timer.current);
    if (v === '') write('');
    else timer.current = setTimeout(() => write(v), delayMs);
  }, [write, delayMs]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setLocal('');
    write('');
  }, [write]);

  return { text, setText, clear };
}
