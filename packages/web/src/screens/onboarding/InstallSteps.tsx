import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { isIos, useInstallPrompt } from './install';

/** The iPhone / iPad (Safari) steps; also on the Install instructions screen. */
export function IosStepList() {
  return (
    <ol className="install__steps">
      <li>Tap <strong>⋯</strong> next to the address bar, then <strong>Share</strong> (older iPhones: tap <strong>Share</strong> at the bottom)</li>
      <li>Scroll down the list (tap <strong>View More</strong> if you see it) and choose <strong>Add to Home Screen</strong></li>
      <li>Not there? At the very bottom tap <strong>Edit Actions</strong>, add <strong>Add to Home Screen</strong>, then choose it</li>
      <li>Keep <strong>Open as Web App</strong> on and tap <strong>Add</strong></li>
    </ol>
  );
}

/** Android (Chrome) steps for the Install instructions screen. */
export function AndroidStepList() {
  return (
    <ol className="install__steps">
      <li>Open <strong>Chrome</strong> and go to the app</li>
      <li>Tap <strong>⋮</strong> (top right)</li>
      <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>), then <strong>Install</strong></li>
    </ol>
  );
}

/** PC (Chrome, Edge) steps for the Install instructions screen. */
export function PcStepList() {
  return (
    <ol className="install__steps">
      <li>Open the app in <strong>Chrome</strong> or <strong>Edge</strong></li>
      <li>Click the install icon at the right end of the address bar, or open <strong>⋮</strong> then <strong>Cast, save and share</strong></li>
      <li>Choose <strong>Install page as app</strong>, then <strong>Install</strong></li>
    </ol>
  );
}

/** "Install the app" (Walkthrough.wf install card): steps for iPhone/iPad Safari and Android/PC Chrome or Edge. */
export function InstallSteps({ open, onClose, closeLabel = 'Not now' }: { open: boolean; onClose: () => void; closeLabel?: string }) {
  const install = useInstallPrompt();
  const ios = isIos();
  const iosSteps = (
    <section aria-labelledby="install-ios" className="install__block">
      <h3 id="install-ios" className="install__heading">iPhone / iPad (Safari)</h3>
      <IosStepList />
    </section>
  );
  const chromeSteps = (
    <section aria-labelledby="install-chrome" className="install__block">
      <h3 id="install-chrome" className="install__heading">Android / PC (Chrome, Edge)</h3>
      {install ? (
        <Button variant="primary" onClick={() => void install().then(onClose)}>Install</Button>
      ) : (
        <ol className="install__steps">
          <li>Open the <strong>⋮</strong> menu</li>
          <li>Tap <strong>Install app</strong></li>
        </ol>
      )}
    </section>
  );
  return (
    <Sheet open={open} title="Install the app" onClose={onClose}
      footer={<Button className="install__later" onClick={onClose}>{closeLabel}</Button>}>
      <div className="install">
        {ios ? <>{iosSteps}{chromeSteps}</> : <>{chromeSteps}{iosSteps}</>}
      </div>
    </Sheet>
  );
}
