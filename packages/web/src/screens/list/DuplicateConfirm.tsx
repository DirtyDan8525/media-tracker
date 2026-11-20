import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { Category } from '@media-tracker/shared';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import type { ConfirmDuplicate } from '../../hooks/useAddEntry';
import { listLabel } from '../../lists/registry';

/** "Already on your list" (Dan, 2026-11-16): Add again / Open it / Cancel. Returns the ask and its sheet. */
export function useDuplicateConfirm(): { confirm: ConfirmDuplicate; element: ReactNode } {
  const navigate = useNavigate();
  const [ask, setAsk] = useState<{ title: string; category: Category; existingId: string } | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const confirm = useCallback<ConfirmDuplicate>((title, category, existingId) => new Promise<boolean>((res) => {
    resolver.current = res;
    setAsk({ title, category, existingId });
  }), []);
  const done = (v: boolean) => { resolver.current?.(v); resolver.current = null; setAsk(null); };
  const element = ask && (
    <Sheet open title="Already on your list" onClose={() => done(false)}
      footer={(
        <div className="stack-10">
          <Button variant="primary" className="btn--block" onClick={() => done(true)}>Add again</Button>
          {ask.existingId && (
            <Button className="btn--block" onClick={() => { const id = ask.existingId; done(false); navigate(`/entry/${id}`); }}>Open it</Button>
          )}
          <Button variant="ghost" className="btn--block" onClick={() => done(false)}>Cancel</Button>
        </div>
      )}>
      <p>{`“${ask.title}” is already on your ${listLabel(ask.category)} list. Add it a second time?`}</p>
    </Sheet>
  );
  return { confirm, element };
}
