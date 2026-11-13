import { effectiveLookupState } from '../../data/entryCache';
import { Button } from '../../design/components/Button';
import type { Entry } from '@media-tracker/shared';

/** Under a row's title while its lookup runs, or after it found nothing: "Looking it up…" / "Couldn't find it" + actions. */
export function LookupNote({ entry, onRetry, onPaste }: { entry: Entry; onRetry: (e: Entry) => void; onPaste: (e: Entry) => void }) {
  const state = effectiveLookupState(entry);
  if (state === 'ok') return null;
  if (state === 'pending') return <span className="entry-card__note" aria-live="polite">Looking it up…</span>;
  return (
    <>
      <span className="entry-card__note">Couldn't find it</span>
      <span className="entry-card__actions">
        <Button variant="primary" compact onClick={() => onRetry(entry)}>Retry</Button>
        <Button variant="ghost" compact onClick={() => onPaste(entry)}>Paste image link</Button>
      </span>
    </>
  );
}
