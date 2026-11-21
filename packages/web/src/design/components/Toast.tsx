import '../toast-action.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** A button in the toast ("Added to Anime · Open"). A toast with an action stays a little longer. */
export interface ToastAction { label: string; onClick: () => void }
interface ToastApi { show: (message: string, action?: ToastAction) => void }
const ToastContext = createContext<ToastApi>({ show: () => {} });

const TOAST_MS = 4000;
const TOAST_ACTION_MS = 7000;

/** One toast at a time, announced politely. The live region stays mounted so screen readers catch updates. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; id: number; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, action?: ToastAction) => setMsg({ text, id: Date.now(), action }), []);
  useEffect(() => {
    if (!msg) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), msg.action ? TOAST_ACTION_MS : TOAST_MS);
    return () => clearTimeout(timer.current);
  }, [msg]);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div role="status" aria-live="polite" className="toast-region">
        {msg && (
          <div key={msg.id} className="toast">
            {msg.text}
            {msg.action && (
              <>
                <span aria-hidden="true"> · </span>
                <button type="button" className="toast__action" onClick={() => { const { onClick } = msg.action!; setMsg(null); onClick(); }}>{msg.action.label}</button>
              </>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastApi => useContext(ToastContext);
