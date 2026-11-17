import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { CustomColors } from './settings/CustomColors';
import { ThemePicker } from './settings/ThemePicker';
import '../design/settings.css';

/** Settings → Appearance (SettingsAppearance.v2 / SettingsCustom.v2), reached from Settings;
 * Back returns to whichever you came from (More when opened directly). */
export function AppearanceScreen() {
  const me = useSessionMe();
  return (
    <div className="screen">
      <PageHeader title="Settings" backTo="/settings" backUsesHistory />
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

      </div>
    </div>
  );
}
