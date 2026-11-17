import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { isIos, useInstallPrompt } from './install';

/** "Install the app" (Walkthrough.wf install card): steps for iPhone/iPad Safari and Android/PC Chrome or Edge. */
export function InstallSteps({ open, onClose, closeLabel = 'Not now' }: { open: boolean; onClose: () => void; closeLabel?: string }) {
  const install = useInstallPrompt();
  const ios = isIos();
  const iosSteps = (
    <section aria-labelledby="install-ios" className="install__block">
      <h3 id="install-ios" className="install__heading">iPhone / iPad (Safari)</h3>
      <ol className="install__steps">
        <li>Tap <strong>⋯</strong> next to the address bar, then <strong>Share</strong> (older iPhones: tap <strong>Share</strong> at the bottom)</li>
        <li>Scroll down the list (tap <strong>View More</strong> if you see it) and choose <strong>Add to Home Screen</strong></li>
        <li>Not there? At the very bottom tap <strong>Edit Actions</strong>, add <strong>Add to Home Screen</strong>, then choose it</li>
        <li>Keep <strong>Open as Web App</strong> on and tap <strong>Add</strong></li>
      </ol>
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
