import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { CustomColors } from './settings/CustomColors';
import { TEXT_SCALES, setTextScale, useTextScale } from '../design/deviceLook';
import { ThemePicker } from './settings/ThemePicker';
import '../design/settings.css';

/** Settings → Appearance (SettingsAppearance.v2 / SettingsCustom.v2), reached from Settings;
 * Back returns to whichever you came from (More when opened directly). */
export function AppearanceScreen() {
  const me = useSessionMe();
  const scale = useTextScale() ?? 'default';
  return (
    <div className="screen">
      <PageHeader title="Settings" backTo="/settings" backUsesHistory />
      <div className="screen__body stack-18">
        <section aria-labelledby="set-look" className="group">
          <h2 id="set-look" className="group__title">Appearance</h2>
          <p className="hint">Saved on this device only.</p>
          <ThemePicker />
        </section>

        <section aria-labelledby="set-textsize" className="group">
          <h2 id="set-textsize" className="group__title">Text size</h2>
          <p className="hint">Saved on this device only.</p>
          <div role="radiogroup" aria-label="Text size" className="chips chips__row">
            {TEXT_SCALES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={scale === t.id} className={`btn btn--chip${scale === t.id ? ' is-active' : ''}`}
                onClick={() => setTextScale(t.id)}>{t.label}</button>
            ))}
          </div>
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
