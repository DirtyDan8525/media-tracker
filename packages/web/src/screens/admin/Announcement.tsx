import { ANNOUNCEMENT_MAX, LINK_MAX, type Announcement } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { useResetSetting, useSaveSetting } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { AdminPage, Count, Result, saveError, useFeedback } from './parts';
import '../../design/onboarding.css';

const isHttp = (v: string) => { try { const p = new URL(v).protocol; return p === 'https:' || p === 'http:'; } catch { return false; } };

/** /admin/announcement (AD3): the banner at the top of Home. */
export function AnnouncementScreen() {
  return <AdminPage title="Announcement">{(app) => <Editor initial={app.settings.announcement} live={app.set.includes('announcement')} />}</AdminPage>;
}

function Editor({ initial, live }: { initial: Announcement; live: boolean }) {
  const save = useSaveSetting();
  const reset = useResetSetting();
  const fb = useFeedback();
  const [text, setText] = useState(initial.text);
  const [link, setLink] = useState(initial.link ?? '');
  const [endsAt, setEndsAt] = useState(initial.endsAt ?? '');
  const [on, setOn] = useState(live && initial.text !== '');
  const [errors, setErrors] = useState<{ text?: string; link?: string }>({});
  const ids = { text: useId(), link: useId(), end: useId(), count: useId(), textErr: useId(), linkErr: useId() };
  const trimmed = text.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!trimmed) errs.text = 'Write the announcement first, or use Turn off.';
    else if (trimmed.length > ANNOUNCEMENT_MAX) errs.text = `Keep it to ${ANNOUNCEMENT_MAX} characters.`;
    if (link.trim() && (link.trim().length > LINK_MAX || !isHttp(link.trim()))) errs.link = 'Use a full web address that starts with https://';
    setErrors(errs);
    if (errs.text || errs.link) { fb.fail(errs.text ?? errs.link!); return; }
    try {
      await save.mutateAsync({ key: 'announcement', value: { text: trimmed, link: link.trim() || null, endsAt: endsAt || null } });
      setOn(true);
      fb.ok('Announcement saved. It shows at the top of Home.');
    } catch (err) {
      fb.fail(saveError(err, 'announcement'));
    }
  }

  async function turnOff() {
    try {
      await reset.mutateAsync('announcement');
      setText(''); setLink(''); setEndsAt(''); setErrors({}); setOn(false);
      fb.ok('Announcement turned off.');
    } catch (err) {
      fb.fail(saveError(err, 'announcement'));
    }
  }

  return (
    <section aria-labelledby="an-title" className="group">
      <h2 id="an-title" className="group__title">Announcement <span className="muted">· {on ? 'On' : 'Off'}</span></h2>
      <form className="admin-card" onSubmit={(e) => void submit(e)} noValidate>
        <div className="admin-field">
          <label htmlFor={ids.text}>Text</label>
          <textarea id={ids.text} rows={3} value={text} aria-invalid={!!errors.text} aria-describedby={`${ids.count}${errors.text ? ` ${ids.textErr}` : ''}`}
            onChange={(e) => { setText(e.target.value); setErrors((x) => ({ ...x, text: undefined })); }} />
          <Count id={ids.count} n={text.length} max={ANNOUNCEMENT_MAX} />
          {errors.text && <span id={ids.textErr} className="field-error">{errors.text}</span>}
        </div>
        <div className="admin-field">
          <label htmlFor={ids.link}>Link (optional)</label>
          <input id={ids.link} type="url" inputMode="url" value={link} placeholder="https://" aria-invalid={!!errors.link} aria-describedby={errors.link ? ids.linkErr : undefined}
            onChange={(e) => { setLink(e.target.value); setErrors((x) => ({ ...x, link: undefined })); }} />
          {errors.link && <span id={ids.linkErr} className="field-error">{errors.link}</span>}
        </div>
        <div className="admin-field">
          <label htmlFor={ids.end}>Show until (optional)</label>
          <input id={ids.end} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
        <div className="admin-preview">
          <span className="admin-field__label">Preview of the Home banner</span>
          {trimmed ? (
            <div className="announcement" role="group" aria-label="Preview">
              <p className="announcement__text">{trimmed}{link.trim() && isHttp(link.trim()) && <> <span className="announcement__link">Read more</span></>}</p>
            </div>
          ) : <span className="hint">Nothing to show yet.</span>}
        </div>
        <Result fb={fb.fb} />
        <div className="admin-actions">
          <Button type="submit" variant="primary" disabled={save.isPending}>Save</Button>
          <Button onClick={() => void turnOff()} disabled={reset.isPending || !on}>Turn off</Button>
        </div>
      </form>
    </section>
  );
}
