import type { RatingSet } from '@media-tracker/shared';
import { useState } from 'react';
import { clearCloseCalls } from '../../data/ratings';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { useQueryClient } from '@tanstack/react-query';

/** Confirms "Undo all my answers for <List>": every close-call answer in that list is undone and scores go back to the typed numbers. */
export function UndoAnswersSheet({ set, label, onClose, onDone }: { set: RatingSet; label: string; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function undo() {
    setBusy(true);
    setFailed(false);
    const ok = await clearCloseCalls(qc, set);
    setBusy(false);
    if (!ok) { setFailed(true); return; }
    onDone();
  }

  return (
    <Sheet open title={`Undo all my answers for ${label}?`} onClose={onClose}
      footer={(
        <div className="add-footer delete-list__footer">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void undo()}>{busy ? 'Undoing…' : 'Undo all answers'}</Button>
        </div>
      )}>
      <div className="stack-10">
        <p>Your scores go back to the numbers you typed. This can't be undone.</p>
        {failed && <p role="alert" className="field-error">Couldn't undo your answers. Check your connection and try again.</p>}
      </div>
    </Sheet>
  );
}
