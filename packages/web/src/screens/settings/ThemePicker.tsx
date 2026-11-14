import { THEMES, type UserSettings } from '@media-tracker/shared';
import type { CSSProperties } from 'react';
import { useSaveSettings } from '../../data/useMe';
import { Icon } from '../../design/components/Icon';
import { useToast } from '../../design/components/Toast';
import { themeColors } from '../../design/theme';
import { useSessionMe } from '../../shell/SessionGate';

const NAMES = [...Object.keys(THEMES), 'Custom'];

/**
 * Settings → Appearance: a "Theme" radio group, the 12 themes in `THEMES` order then Custom
 * (SettingsAppearance.v2). Each option previews Background, Cards, Text and Highlight.
 */
export function ThemePicker() {
  const me = useSessionMe();
  const save = useSaveSettings();
  const toast = useToast();
  const current = me.settings.theme;

  function pick(theme: string) {
    if (theme === current) return;
    // Custom with nothing saved starts from the theme on screen, so the editor opens on familiar colours.
    const partial: Partial<UserSettings> = theme === 'Custom' && Object.keys(me.settings.colors).length === 0
      ? { theme, colors: { ...themeColors(me.settings) } }
      : { theme };
    save.mutate(partial, { onError: () => toast.show("Couldn't save your settings. Try again.") });
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="theme-grid">
      {NAMES.map((name, i) => {
        const on = name === current;
        const t = THEMES[name];
        return (
          <label key={name} className={`theme-swatch rise-in${on ? ' is-on' : ''}${t ? '' : ' theme-swatch--custom'}`}
            style={{ '--i': i } as CSSProperties}>
            <input type="radio" name="theme" value={name} checked={on} onChange={() => pick(name)} />
            {t ? (
              <span className="theme-swatch__pv" aria-hidden="true" style={{ background: t.Background }}>
                <span style={{ background: t.Cards }}>
                  <i className="theme-swatch__text" style={{ background: t.Text }} />
                  <i className="theme-swatch__hl" style={{ background: t.Highlight }} />
                </span>
              </span>
            ) : (
              <span className="theme-swatch__pv theme-swatch__pv--icon" aria-hidden="true"><Icon name="palette" size={22} /></span>
            )}
            <span className="theme-swatch__name">{on && <Icon name="check" size={13} />}{name}</span>
          </label>
        );
      })}
    </div>
  );
}
