import {
  ACCENT_COLORS, BRAND_NAME_MAX, BRAND_WELCOME_MAX, THEMES, type Brand, type NewPersonDefaults,
} from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { useSaveSetting } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { accentReadable } from '../../design/theme';
import { accentName, AdminPage, Count, Result, saveError, THEME_NAMES, useFeedback } from './parts';

/** Where does an accent read at AA (4.5:1) as text? Checked on the theme's Background and Cards. */
function readableOn(accent: string): { midnight: boolean; sakura: boolean } {
  return { midnight: accentReadable(accent, THEMES.Midnight!), sakura: accentReadable(accent, THEMES.Sakura!) };
}

function contrastNote(accent: string | null): string {
  if (!accent) return "Using each theme's own highlight colour.";
  const r = readableOn(accent);
  const name = accentName(accent);
  const where = r.midnight && r.sakura ? 'passes AA contrast (4.5:1) on Midnight and Sakura'
    : r.midnight ? 'passes AA contrast (4.5:1) on Midnight but not on Sakura'
      : r.sakura ? 'passes AA contrast (4.5:1) on Sakura but not on Midnight' : 'does not pass AA contrast (4.5:1) on Midnight or Sakura';
  return `Selected: ${name}. It ${where}. People whose theme it doesn't suit keep their theme's own highlight.`;
}

/** /admin/look (AD5): app name, sign-in welcome text, accent colour, and the theme new people start with. */
export function LookScreen() {
  return <AdminPage title="App text and look">{(app) => <LookForm brand={app.settings.brand} defaults={app.settings.defaults} />}</AdminPage>;
}

function LookForm({ brand, defaults }: { brand: Brand; defaults: NewPersonDefaults }) {
  const save = useSaveSetting();
  const fb = useFeedback();
  const [name, setName] = useState(brand.name);
  const [welcome, setWelcome] = useState(brand.welcome);
  const [accent, setAccent] = useState<string | null>(brand.accent);
  const [theme, setTheme] = useState(defaults.theme);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const ids = { name: useId(), nameCount: useId(), nameErr: useId(), welcome: useId(), welcomeCount: useId(), theme: useId(), note: useId() };
  const group = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setNameErr('Give the app a name.'); fb.fail('Give the app a name.'); return; }
    if (n.length > BRAND_NAME_MAX) { setNameErr(`Keep the name to ${BRAND_NAME_MAX} characters.`); fb.fail(`Keep the name to ${BRAND_NAME_MAX} characters.`); return; }
    if (welcome.length > BRAND_WELCOME_MAX) { fb.fail(`Keep the welcome text to ${BRAND_WELCOME_MAX} characters.`); return; }
    setNameErr(null);
    try {
      await save.mutateAsync({ key: 'brand', value: { name: n, welcome: welcome.trim(), accent } });
      if (theme !== defaults.theme) await save.mutateAsync({ key: 'defaults', value: { ...defaults, theme } });
      fb.ok('App text and look saved.');
    } catch (err) {
      fb.fail(saveError(err, 'look'));
    }
  }

  return (
    <section aria-labelledby="lk-title" className="group">
      <h2 id="lk-title" className="group__title">App text and look</h2>
      <form className="admin-card" onSubmit={(e) => void submit(e)} noValidate>
        <div className="admin-field">
          <label htmlFor={ids.name}>App name</label>
          <input id={ids.name} type="text" value={name} maxLength={BRAND_NAME_MAX + 10} aria-invalid={!!nameErr}
            aria-describedby={`${ids.nameCount}${nameErr ? ` ${ids.nameErr}` : ''}`} onChange={(e) => { setName(e.target.value); setNameErr(null); }} />
          <Count id={ids.nameCount} n={name.length} max={BRAND_NAME_MAX} />
          {nameErr && <span id={ids.nameErr} className="field-error">{nameErr}</span>}
        </div>
        <div className="admin-field">
          <label htmlFor={ids.welcome}>Sign-in welcome text</label>
          <textarea id={ids.welcome} rows={3} value={welcome} aria-describedby={ids.welcomeCount} onChange={(e) => setWelcome(e.target.value)} />
          <Count id={ids.welcomeCount} n={welcome.length} max={BRAND_WELCOME_MAX} />
        </div>
        <fieldset className="admin-swatches" aria-describedby={ids.note}>
          <legend className="admin-field__label">Accent colour</legend>
          <label className="admin-swatch">
            <input type="radio" name={group} checked={accent === null} onChange={() => setAccent(null)} />
            <i style={{ background: 'var(--highlight)' }} aria-hidden="true" />Theme's own
          </label>
          {ACCENT_COLORS.map((c) => (
            <label key={c} className="admin-swatch">
              <input type="radio" name={group} checked={accent === c} onChange={() => setAccent(c)} />
              <i style={{ background: c }} aria-hidden="true" />{accentName(c)}
            </label>
          ))}
        </fieldset>
        <p id={ids.note} className="hint" role="status">{contrastNote(accent)}</p>
        <div className="admin-field">
          <label htmlFor={ids.theme}>Default theme for new people</label>
          <select id={ids.theme} value={theme} onChange={(e) => setTheme(e.target.value)}>
            {THEME_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Result fb={fb.fb} />
        <div className="admin-actions"><Button type="submit" variant="primary" disabled={save.isPending}>Save</Button></div>
      </form>
    </section>
  );
}
