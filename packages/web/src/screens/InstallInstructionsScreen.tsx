import { PageHeader } from '../shell/PageHeader';
import { AndroidStepList, IosStepList, PcStepList } from './onboarding/InstallSteps';
import '../design/onboarding.css';
import '../design/settings.css';

/** More → Install instructions: the same steps as the install sheet, one clear section per device. */
export function InstallInstructionsScreen() {
  return (
    <div className="screen">
      <PageHeader title="Install instructions" backTo="/more" backUsesHistory sub="Put the app on your home screen or desktop." />
      <div className="screen__body stack-18">
        <section aria-labelledby="inst-ios" className="install__block">
          <h2 id="inst-ios" className="install__heading">iPhone / iPad (Safari)</h2>
          <IosStepList />
        </section>
        <section aria-labelledby="inst-android" className="install__block">
          <h2 id="inst-android" className="install__heading">Android (Chrome)</h2>
          <AndroidStepList />
        </section>
        <section aria-labelledby="inst-pc" className="install__block">
          <h2 id="inst-pc" className="install__heading">PC (Chrome or Edge)</h2>
          <PcStepList />
        </section>
      </div>
    </div>
  );
}
