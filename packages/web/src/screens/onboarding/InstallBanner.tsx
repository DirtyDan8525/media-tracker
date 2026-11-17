import { useState } from 'react';
import { useAppName, useFeature } from '../../data/appSettings';
import { IconButton } from '../../design/components/IconButton';
import { InstallSteps } from './InstallSteps';
import { isInstalled } from './install';
import { dismissInstall, installDismissed } from './storage';
import '../../design/onboarding.css';

/**
 * Home banner: "Install Media Tracker · Show me how ✕". Hidden once the app is installed or the
 * user has dismissed it (remembered on this device).
 */
export function InstallBanner() {
  const [dismissed, setDismissed] = useState(installDismissed);
  const [open, setOpen] = useState(false);
  const appName = useAppName();
  const on = useFeature('installBanner');
  if (!on || dismissed || isInstalled()) return null;
  return (
    <>
      <div className="install-banner" role="region" aria-label={`Install ${appName}`}>
        <span className="install-banner__text">Install {appName}</span>
        <button type="button" className="install-banner__how" onClick={() => setOpen(true)}>Show me how</button>
        <IconButton label="Dismiss" icon="close" look="plain" onClick={() => { dismissInstall(); setDismissed(true); }} />
      </div>
      <InstallSteps open={open} onClose={() => setOpen(false)} closeLabel="Close" />
    </>
  );
}
