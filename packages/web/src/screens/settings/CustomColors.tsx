import type { ThemeColors } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { setDeviceTheme } from '../../design/deviceLook';
import { Icon } from '../../design/components/Icon';
import { applyTheme, contrastWarnings, ROLE_VARS, themeColors, type ContrastWarning } from '../../design/theme';
import { useSessionMe } from '../../shell/SessionGate';

const HEX_RE = /^#[0-9a-f]{6}$/i;
const ROLES = Object.keys(ROLE_VARS) as (keyof typeof ROLE_VARS)[];

/** One decimal, rounded down, so a ratio just under 4.5 never reads as "4.5:1". */
const oneDecimal = (r: number) => (Math.floor(r * 10) / 10).toFixed(1);
export const warningText = (w: ContrastWarning) =>
  `${w.role} is hard to read on ${w.surface} (${oneDecimal(w.ratio)}:1; aim for 4.5:1).`;

/**
 * Settings → Custom colours (SettingsCustom.v2), shown only for the Custom theme: per role a colour
 * input and a hex box. Edits apply and save at once, on this device only. Hard-to-read pairs warn but still save (Ruling P11).
 */
export function CustomColors() {
  const me = useSessionMe();
  const baseId = useId();
  const saved = themeColors(me.settings);
  const savedKey = JSON.stringify(saved);

  const [draft, setDraft] = useState<ThemeColors>(saved);
  const [text, setText] = useState<Record<string, string>>(saved);
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const draftRef = useRef(draft);

  // The saved colours changed under us (say, another tab): show them. Our own save landing changes nothing.
  useEffect(() => {
    if (JSON.stringify(draftRef.current) === savedKey) return;
    const next = JSON.parse(savedKey) as ThemeColors;
    draftRef.current = next;
    setDraft(next);
    setText(next);
    setBad({});
  }, [savedKey]);

  // Colours are saved on this device only, so an edit applies and saves at once (no waiting on the server).
  function commit(role: string, hex: string) {
    const next = { ...draftRef.current, [role]: hex.toLowerCase() };
    draftRef.current = next;
    setDraft(next);
    applyTheme({ theme: 'Custom', colors: next });
    setDeviceTheme({ theme: 'Custom', colors: next });
  }

  function onColor(role: string, value: string) {
    setText((t) => ({ ...t, [role]: value }));
    setBad((b) => ({ ...b, [role]: false }));
    commit(role, value);
  }

  function onHex(role: string, value: string) {
    setText((t) => ({ ...t, [role]: value }));
    if (HEX_RE.test(value)) {
      setBad((b) => ({ ...b, [role]: false }));
      commit(role, value);
    } else {
      // Complain once it can't be a half-typed colour any more; blur checks the rest.
      setBad((b) => ({ ...b, [role]: value.length >= 7 }));
    }
  }

  function onHexBlur(role: string) {
    setBad((b) => ({ ...b, [role]: !HEX_RE.test(text[role] ?? '') }));
  }

  const warnings = contrastWarnings(draft);
  // The button label is a result of several roles; flag the Highlight row (the fill it sits on).
  const warned = new Set<string>(warnings.map((w) => (w.surface === 'Highlight' ? 'Highlight' : w.role)));

  return (
    <>
      <div className="group__card">
        {ROLES.map((role) => {
          const labelId = `${baseId}-${role.replace(/\s/g, '-')}`;
          const errId = `${labelId}-err`;
          return (
            <div key={role} className="color-row">
              <span className="color-row__name">
                <span id={labelId}>{role}</span>
                {warned.has(role) && <span className="color-row__warn" role="img" aria-label="Hard to read"><Icon name="warning" size={16} /></span>}
              </span>
              <input type="color" className="color-row__swatch" aria-labelledby={labelId}
                value={draft[role] ?? '#000000'} onChange={(e) => onColor(role, e.target.value)} />
              <input type="text" className="color-row__hex" aria-label={`${role} hex`} spellCheck={false}
                autoCapitalize="off" autoComplete="off" maxLength={7}
                value={text[role] ?? ''} aria-invalid={bad[role] ? true : undefined} aria-describedby={bad[role] ? errId : undefined}
                onChange={(e) => onHex(role, e.target.value.trim())} onBlur={() => onHexBlur(role)} />
              {bad[role] && <p id={errId} className="field-error color-row__err">Use a colour like #1b1b25.</p>}
            </div>
          );
        })}
      </div>
      <div aria-live="polite">
        {warnings.length > 0 && (
          <ul className="color-warnings">
            {warnings.map((w) => (
              <li key={`${w.role}|${w.surface}`}>
                <span className="color-warnings__icon"><Icon name="warning" size={16} /></span>
                <span>{warningText(w)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
