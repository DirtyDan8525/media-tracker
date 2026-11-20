import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Button } from '../../design/components/Button';
import { ListsOrderSheet } from '../../shell/ListsOrderSheet';
import { setNavWidth, useNavWidth } from '../../shell/navWidth';

/** Settings → On this computer: Reorder lists (the same sheet as the side bar's button) and the side bar width reset. Also scrolls to the Cover viewer switch for `/settings#cover-viewer`. */
export function SideBarRows() {
  const [open, setOpen] = useState(false);
  const width = useNavWidth();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== '#cover-viewer') return;
    const el = document.getElementById('cover-viewer');
    el?.scrollIntoView?.({ block: 'center' });
    el?.querySelector<HTMLElement>('input')?.focus();
  }, [hash]);
  return (
    <>
      <div className="settings-inline-row">
        <Button compact onClick={() => setOpen(true)}>Reorder lists</Button>
        {width !== null && <Button compact variant="ghost" onClick={() => setNavWidth(null)}>Reset side bar width</Button>}
      </div>
      {open && <ListsOrderSheet open onClose={() => setOpen(false)} />}
    </>
  );
}
