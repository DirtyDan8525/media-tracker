import type { RecSnapshot } from '@media-tracker/shared';
import { useState } from 'react';
import { IconButton } from '../../design/components/IconButton';
import { ShareSheet } from './ShareSheet';
import '../../design/messages.css';

/** The Share button in a title page's top bar (yours and friends'): opens the Share sheet for this title (M7). */
export function ShareButton({ rec }: { rec: RecSnapshot }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Share" icon="share" look="plain" className="detail-top__share" aria-haspopup="dialog" onClick={() => setOpen(true)} />
      <ShareSheet open={open} rec={rec} onClose={() => setOpen(false)} />
    </>
  );
}
