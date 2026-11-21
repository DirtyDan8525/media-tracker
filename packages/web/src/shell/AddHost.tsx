import type { Category, Entry } from '@media-tracker/shared';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Sheet } from '../design/components/Sheet';
import { Skeleton } from '../design/components/Skeleton';
import { useToast } from '../design/components/Toast';
import { useAddEntry, type AddInput } from '../hooks/useAddEntry';
import { listLabel } from '../lists/registry';
import { useCloseCall } from '../screens/sharpen/CloseCallSheet';
import { useDuplicateConfirm } from '../screens/list/DuplicateConfirm';
import { useCurrentList } from './currentList';
import { readLastAddList, resolveAddList } from './lastAddList';
import { useEnabledLists } from './useLists';

// The same lazy sheets the list screen uses: their code loads on the first tap.
const AddEntry = lazy(() => import('../screens/AddEntry').then((m) => ({ default: m.AddEntry })));
const PickerSheet = lazy(() => import('../screens/PickerSheet').then((m) => ({ default: m.PickerSheet })));

function SheetFallback({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Sheet open title={title} onClose={onClose}>
      <div aria-busy="true" className="stack-10"><Skeleton height={48} /><Skeleton height={48} /><Skeleton height={120} /></div>
    </Sheet>
  );
}

const AddContext = createContext<(() => void) | null>(null);

/**
 * Add without leaving the screen (Activity, Search, anything that is not a list): the Add sheet opens on top, on the list you last
 * added to (this device; else the current list). Saving keeps you where you are and toasts "Added to <List> · Open" (Open goes to the
 * title). The duplicate question, the which-one-did-you-mean picker and the close-rating question work as they do on a list.
 * Lists have their own Add (ListScreen) and still use their own list.
 */
export function AddProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();
  const enabled = useEnabledLists();
  const current = useCurrentList();
  const [start, setStart] = useState<Category | null>(null);
  const dup = useDuplicateConfirm();
  const onSaved = useCallback((entry: Entry) => {
    toast.show(`Added to ${listLabel(entry.category)}`, { label: 'Open', onClick: () => navigate(`/entry/${entry.id}`) });
  }, [toast, navigate]);
  const add = useAddEntry(current ?? enabled[0] ?? 'anime', dup.confirm, onSaved);
  const { ask: askClose, element: closeCallSheet } = useCloseCall();
  const [askFor, setAskFor] = useState<Entry | null>(null);
  // A rated add: once the entry is saved and its lookup (and picker) is done, ask about close ratings (N6).
  useEffect(() => {
    if (askFor === null || (add.state !== 'idle' && add.state !== 'saved')) return;
    void askClose(askFor.category, askFor.id);
    setAskFor(null);
  }, [askFor, add.state, askClose]);

  const open = useCallback(() => {
    const first = resolveAddList(readLastAddList(), enabled, current);
    if (first) setStart(first);
  }, [enabled, current]);
  const submit = async (input: AddInput) => {
    const entry = await add.add(input);
    if (entry && entry.rating !== null) setAskFor(entry);
  };

  return (
    <AddContext.Provider value={useMemo(() => open, [open])}>
      {children}
      {start !== null && (
        <Suspense fallback={<SheetFallback title="Add" onClose={() => setStart(null)} />}>
          <AddEntry category={start} onSubmit={(input) => void submit(input)} onClose={() => setStart(null)} />
        </Suspense>
      )}
      {dup.element}
      {add.state === 'choose' && add.pickTarget && (
        <Suspense fallback={<SheetFallback title="Which one did you mean?" onClose={() => void add.keepTyped()} />}>
          <PickerSheet
            category={add.pickTarget.entry.category} typed={add.pickTarget.typed} choices={add.choices}
            onChoose={(info) => void add.choose(info)} onKeepTyped={() => void add.keepTyped()} onSearch={add.search}
          />
        </Suspense>
      )}
      {closeCallSheet}
    </AddContext.Provider>
  );
}

/** Opens the Add sheet in place, or null outside an `AddProvider` (a list opens its own). */
export const useOpenAdd = (): (() => void) | null => useContext(AddContext);
