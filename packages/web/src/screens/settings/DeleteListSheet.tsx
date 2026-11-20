import type { CustomList } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { useDeleteList } from '../../data/customLists';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';

/**
 * Deleting a custom list deletes every title on it, so the person types the list's name first (case and outer spaces
 * don't matter). Nothing is deleted until the names match and Delete is pressed.
 */
export function DeleteListSheet({ list, onClose, onDeleted }: { list: CustomList; onClose: () => void; onDeleted?: () => void }) {
  const del = useDeleteList();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const ids = { input: useId(), hint: useId(), err: useId() };
  const matches = typed.trim().toLocaleLowerCase() === list.name.trim().toLocaleLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    try {
      await del.mutateAsync(list);
      toast.show(`${list.name} deleted`);
      onClose();
      onDeleted?.();
    } catch {
      // the error line below says so
    }
  }

  return (
    <Sheet open title={`Delete ${list.name}?`} onClose={onClose}
      footer={(
        <div className="add-footer delete-list__footer">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="delete-list-form" variant="primary" disabled={!matches || del.isPending}>
            {del.isPending ? 'Deleting…' : 'Delete list'}
          </Button>
        </div>
      )}>
      <form id="delete-list-form" className="stack-10" onSubmit={(e) => void submit(e)}>
        <p>This deletes the list and every {list.noun} on it, with their ratings, notes and tags. It can't be undone.</p>
        <div className="field">
          <label className="field-label" htmlFor={ids.input}>Type <b>{list.name}</b> to confirm</label>
          <input id={ids.input} data-autofocus className="input" value={typed} autoComplete="off" spellCheck={false}
            aria-describedby={del.isError ? ids.err : undefined} onChange={(e) => setTyped(e.target.value)} />
        </div>
        {del.isError && <p id={ids.err} role="alert" className="field-error">Couldn't delete the list. Check your connection and try again.</p>}
      </form>
    </Sheet>
  );
}
