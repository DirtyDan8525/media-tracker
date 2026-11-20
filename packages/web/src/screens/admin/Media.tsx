import { MEDIA_CAP_MB_RANGE, MEDIA_RETENTION_RANGE, type MediaSetting } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { useAdminMedia, useSaveSetting } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { Skeleton } from '../../design/components/Skeleton';
import { AdminPage, Result, saveError, useFeedback } from './parts';

/** "12.4 MB", "640 KB", "0 B". */
export function bytesText(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** /admin/media: photo and voice memo storage in use, how long files are kept, and each person's cap. */
export function MediaScreen() {
  return <AdminPage title="Photos and voice memos">{(app) => <><Usage /><MediaForm initial={app.settings.media} /></>}</AdminPage>;
}

function Usage() {
  const q = useAdminMedia();
  return (
    <section aria-labelledby="md-use" className="group">
      <h2 id="md-use" className="group__title">Storage used</h2>
      {q.isPending ? <Skeleton height={64} /> : q.isError || !q.data ? <p className="friend-note">Couldn't load the storage numbers.</p> : (
        <div className="admin-card">
          {!q.data.configured && <p className="friend-note">Photo and voice memo storage isn't set up on the server yet (see SETUP, "Turn on photos and voice memos").</p>}
          <dl className="admin-stats">
            <div className="admin-stat"><div><dt>In use</dt><dd>{bytesText(q.data.bytes)}</dd></div></div>
            <div className="admin-stat"><div><dt>Files</dt><dd>{q.data.files}</dd></div></div>
          </dl>
          {q.data.people.length > 0 && (
            <ol className="admin-rank" aria-label="Most storage used">
              {q.data.people.map((p, i) => (
                <li key={p.userId}>
                  <span className="admin-rank__n">{i + 1}</span>
                  <span className="admin-rank__title">{p.username ? `@${p.username}` : 'Deleted account'}</span>
                  <span className="admin-rank__count">{bytesText(p.bytes)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function MediaForm({ initial }: { initial: MediaSetting }) {
  const save = useSaveSetting();
  const fb = useFeedback();
  const [months, setMonths] = useState(String(initial.retentionMonths));
  const [cap, setCap] = useState(String(initial.capMb));
  const ids = { months: useId(), monthsHint: useId(), cap: useId(), capHint: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = Number(months);
    const c = Number(cap);
    if (!Number.isInteger(m) || m < MEDIA_RETENTION_RANGE.min || m > MEDIA_RETENTION_RANGE.max) {
      fb.fail(`Months must be a whole number from ${MEDIA_RETENTION_RANGE.min} to ${MEDIA_RETENTION_RANGE.max}.`);
      return;
    }
    if (!Number.isInteger(c) || c < MEDIA_CAP_MB_RANGE.min || c > MEDIA_CAP_MB_RANGE.max) {
      fb.fail(`The cap must be a whole number of MB from ${MEDIA_CAP_MB_RANGE.min} to ${MEDIA_CAP_MB_RANGE.max}.`);
      return;
    }
    try {
      await save.mutateAsync({ key: 'media', value: { retentionMonths: m, capMb: c } });
      fb.ok('Saved. The daily clean-up uses these from its next run.');
    } catch (err) {
      fb.fail(saveError(err, 'setting'));
    }
  }

  return (
    <section aria-labelledby="md-title" className="group">
      <h2 id="md-title" className="group__title">Clean-up</h2>
      <p className="friend-note">Old files are removed automatically once a day. The message stays and reads "Photo expired" or "Voice memo expired".</p>
      <Result fb={fb.fb} />
      <form className="admin-card" onSubmit={(e) => void submit(e)} noValidate>
        <div className="admin-field">
          <label htmlFor={ids.months}>Keep photos and voice memos for (months)</label>
          <input id={ids.months} type="number" inputMode="numeric" min={MEDIA_RETENTION_RANGE.min} max={MEDIA_RETENTION_RANGE.max} step={1}
            value={months} aria-describedby={ids.monthsHint} onChange={(e) => setMonths(e.target.value)} />
          <span id={ids.monthsHint} className="admin-switch__desc">Older files are removed. Default 6.</span>
        </div>
        <div className="admin-field">
          <label htmlFor={ids.cap}>Storage per person (MB)</label>
          <input id={ids.cap} type="number" inputMode="numeric" min={MEDIA_CAP_MB_RANGE.min} max={MEDIA_CAP_MB_RANGE.max} step={1}
            value={cap} aria-describedby={ids.capHint} onChange={(e) => setCap(e.target.value)} />
          <span id={ids.capHint} className="admin-switch__desc">Over it, that person's oldest files are removed first. Default 300.</span>
        </div>
        <Button type="submit" variant="primary" disabled={save.isPending}>Save</Button>
      </form>
    </section>
  );
}
