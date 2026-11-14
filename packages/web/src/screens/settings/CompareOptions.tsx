import { COMPARE_ASK, COMPARE_ROOM, COMPARE_STYLE, type UserSettings } from '@media-tracker/shared';
import { useEffect, useId, useState } from 'react';
import { useSaveSettings } from '../../data/useMe';
import { Icon } from '../../design/components/Icon';
import { useToast } from '../../design/components/Toast';
import { useSessionMe } from '../../shell/SessionGate';

const NUMBER_RE = /^(\d+([.,]\d*)?|[.,]\d+)$/;

/** "Compare within" as typed: "1", "0.5" or "1,5". Null unless finite, above 0 and at most 10 (R10). */
export function parseWindow(text: string): number | null {
  const t = text.trim();
  if (!NUMBER_RE.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : null;
}

type EnumKey = 'compareAsk' | 'compareStyle' | 'compareRoom';
const SELECTS: { key: EnumKey; label: string; options: readonly string[] }[] = [
  { key: 'compareAsk', label: 'Ask to compare', options: COMPARE_ASK },
  { key: 'compareStyle', label: 'Re-rating style', options: COMPARE_STYLE },
  { key: 'compareRoom', label: "When there's no room", options: COMPARE_ROOM },
];

/** Settings → Comparing: the Sheet's three compare dropdowns and "Compare within" (SettingsAppearance.v2). */
export function CompareOptions() {
  const me = useSessionMe();
  const save = useSaveSettings();
  const toast = useToast();
  const id = useId();
  const saved = me.settings.compareWindow;
  const [text, setText] = useState(String(saved));
  const [invalid, setInvalid] = useState(false);

  // Show the saved value again whenever it changes (a save landed, or a failed one rolled back).
  useEffect(() => { setText(String(saved)); setInvalid(false); }, [saved]);

  const persist = (partial: Partial<UserSettings>, onError?: () => void) =>
    save.mutate(partial, { onError: () => { onError?.(); toast.show("Couldn't save your settings. Try again."); } });

  function commitWindow() {
    const n = parseWindow(text);
    if (n === null) { setInvalid(true); return; }
    setInvalid(false);
    setText(String(n));
    // The rollback can land in the same render as the optimistic value, so put the old text back here too.
    if (n !== saved) persist({ compareWindow: n }, () => setText(String(saved)));
  }

  const winId = `${id}-win`;
  const errId = `${id}-win-err`;
  return (
    <div className="group__card">
      {SELECTS.map(({ key, label, options }) => (
        <div key={key} className="option-field">
          <label htmlFor={`${id}-${key}`}>{label}</label>
          <span className="select-wrap">
            <select id={`${id}-${key}`} value={me.settings[key]} onChange={(e) => persist({ [key]: e.target.value })}>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <Icon name="chevron" size={16} />
          </span>
        </div>
      ))}
      <div className="option-field option-field--inline">
        <label htmlFor={winId}>Compare within</label>
        <input id={winId} className="window-input" type="text" inputMode="decimal" autoComplete="off"
          value={text} aria-invalid={invalid || undefined} aria-describedby={invalid ? errId : undefined}
          onChange={(e) => setText(e.target.value)} onBlur={commitWindow}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitWindow(); } }} />
        {invalid && <p id={errId} className="field-error option-field__err">Enter a number above 0, up to 10.</p>}
      </div>
    </div>
  );
}
