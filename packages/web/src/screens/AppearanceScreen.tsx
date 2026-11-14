import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { CompareOptions } from './settings/CompareOptions';
import { CustomColors } from './settings/CustomColors';
import { ThemePicker } from './settings/ThemePicker';
import '../design/settings.css';

/** Settings → Appearance and Comparing (SettingsAppearance.v2 / SettingsCustom.v2), reached from More and Settings. */
export function AppearanceScreen() {
  const me = useSessionMe();
  return (
    <div className="screen">
      <PageHeader title="Settings" backTo="/more" />
      <div className="screen__body stack-18">
        <section aria-labelledby="set-look" className="group">
          <h2 id="set-look" className="group__title">Appearance</h2>
          <ThemePicker />
        </section>

        {me.settings.theme === 'Custom' && (
          <section aria-labelledby="set-custom" className="group">
            <h2 id="set-custom" className="group__title">Custom colours</h2>
            <CustomColors />
          </section>
        )}

        <section aria-labelledby="set-compare" className="group">
          <h2 id="set-compare" className="group__title">Comparing</h2>
          <CompareOptions />
        </section>
      </div>
    </div>
  );
}
