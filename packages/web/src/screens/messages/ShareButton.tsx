import type { RecSnapshot } from '@media-tracker/shared';
import { useState } from 'react';
import { useFeature } from '../../data/appSettings';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { ShareSheet } from './ShareSheet';
import '../../design/messages.css';

/** The Share button in a title page's top bar (yours and friends'): icon + the word "Share" (Dan, 2026-11-17); opens the Share sheet for this title (M7). */
export function ShareButton({ rec }: { rec: RecSnapshot }) {
  const [open, setOpen] = useState(false);
  // Sharing sends a message: gone while Messages is switched off (AD2).
  if (!useFeature('messages')) return null;
  return (
    <>
      <Button variant="ghost" className="detail-top__share" aria-label={`Share ${rec.title}`} title={`Share ${rec.title}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="share" size={20} />Share
      </Button>
      <ShareSheet open={open} rec={rec} onClose={() => setOpen(false)} />
    </>
  );
}
