import { formatRating, type RatingSet, type SetItem } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { useFeature } from '../../data/appSettings';
import { askCloseCalls, fetchCloseFor, saveClosePick } from '../../data/ratings';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { useToast } from '../../design/components/Toast';
import { useIsWide } from '../../hooks';
import { useSessionMe } from '../../shell/SessionGate';
import { ClosePair, type CloseAnswer } from './ClosePair';

export const PICK_FAILED = "Couldn't save that pick. Try again or skip.";

/** Shown numbers that a session's picks changed, by id: what the summary lists. */
export type Nudged = Map<string, { title: string; rating: number }>;

/** Folds a save's changed titles into the running summary. */
export function addNudged(prev: Nudged, items: SetItem[]): Nudged {
  const next = new Map(prev);
  for (const i of items) if (i.rating !== null) next.set(i.id, { title: i.title, rating: i.rating });
  return next;
}

/** "Nudged to break the tie." with the titles whose numbers moved (RateClose board). */
export function NudgedList({ nudged }: { nudged: Nudged }) {
  return (
    <div className="close-done">
      <ul className="close-done__list">
        {[...nudged].map(([id, n]) => (
          <li key={id} className="close-done__row"><span>{n.title}</span><b className="close-done__num">{formatRating(n.rating)}</b></li>
        ))}
      </ul>
      <p className="field-hint">Nudged to break the tie.</p>
    </div>
  );
}

/**
 * The close-call sheet after a rating is saved (Ruling N6, RateClose board): "Close call", "1 of 2",
 * Skip, "Which did you like more?" with the title just rated against each close title. Each answer
 * saves at once. At the end it lists the numbers that moved, if any, with Done; otherwise it closes.
 */
export function CloseCallSheet({ set, item, others, onClose }: { set: RatingSet; item: SetItem; others: SetItem[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const wide = useIsWide();
  const [k, setK] = useState(0);
  const [busy, setBusy] = useState(false);
  const [nudged, setNudged] = useState<Nudged>(new Map());
  const now = (x: SetItem): SetItem => ({ ...x, rating: nudged.get(x.id)?.rating ?? x.rating });

  const next = (n: Nudged) => {
    if (k + 1 < others.length) { setK(k + 1); return; }
    if (n.size === 0) onClose();
    else setK(others.length);
  };
  async function answer(x: CloseAnswer) {
    const other = others[k];
    if (other === undefined || busy) return;
    if (x === 'skip') { next(nudged); return; }
    const [w, l] = x === 'b' ? [other.id, item.id] : [item.id, other.id];
    setBusy(true);
    const changed = await saveClosePick(qc, set, { winnerId: w, loserId: l, isTie: x === 'same' });
    setBusy(false);
    if (changed === null) { toast.show(PICK_FAILED); return; }
    const n = addNudged(nudged, changed);
    setNudged(n);
    next(n);
  }

  const done = k >= others.length;
  const other = others[k];
  return (
    <Sheet open title="Close call" onClose={onClose}
      footer={done ? <Button variant="primary" className="btn--block" onClick={onClose}>Done</Button> : undefined}>
      {done || other === undefined ? <NudgedList nudged={nudged} /> : (
        <div className="close-call">
          <div className="close-call__bar">
            <span className="close-call__count" aria-live="polite">{k + 1} of {others.length}</span>
            <Button variant="ghost" compact disabled={busy} onClick={() => void answer('skip')}>Skip</Button>
          </div>
          <ClosePair key={other.id} a={now(item)} b={now(other)} busy={busy} wide={wide} onAnswer={(x) => void answer(x)} />
        </div>
      )}
    </Sheet>
  );
}

/**
 * After a rating is saved: asks the Worker for close titles (N6) and, when the setting is on and
 * there are any, opens the close-call sheet. Render `element` somewhere on the screen.
 */
export function useCloseCall(): { ask: (set: RatingSet, id: string) => Promise<void>; element: ReactNode } {
  const me = useSessionMe();
  const featureOn = useFeature('closeCalls');
  const on = featureOn && askCloseCalls(me.settings);
  const [open, setOpen] = useState<{ set: RatingSet; item: SetItem; others: SetItem[] } | null>(null);
  const ask = useCallback(async (set: RatingSet, id: string) => {
    if (!on) return;
    try {
      const r = await fetchCloseFor(set, id);
      if (r.others.length > 0) setOpen({ set, ...r });
    } catch {
      // Nothing to ask when offline; Sharpen my ratings offers the same pairs later.
    }
  }, [on]);
  const element = open && <CloseCallSheet key={open.item.id} {...open} onClose={() => setOpen(null)} />;
  return { ask, element };
}
