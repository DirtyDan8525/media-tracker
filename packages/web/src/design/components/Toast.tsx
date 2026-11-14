import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastApi { show: (message: string) => void }
const ToastContext = createContext<ToastApi>({ show: () => {} });

const TOAST_MS = 4000;

/** One toast at a time, announced politely. The live region stays mounted so screen readers catch updates. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string) => setMsg({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!msg) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), TOAST_MS);
    return () => clearTimeout(timer.current);
  }, [msg]);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div role="status" aria-live="polite" className="toast-region">
        {msg && <div key={msg.id} className="toast">{msg.text}</div>}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastApi => useContext(ToastContext);
