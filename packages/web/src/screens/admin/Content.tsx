import {
  ABOUT_MAX, COMING_SOON_MAX, ITEM_MAX, RELEASE_ITEMS_MAX, RELEASE_VERSION_MAX, WHATS_NEW_MAX_RELEASES, type AppSettingKey, type Release,
} from '@media-tracker/shared';
import { useId, useState } from 'react';
import { useResetSetting, useSaveSetting } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { COMING_SOON, WHATS_NEW } from '../../whatsNew';
import { AdminPage, Count, Result, saveError, useFeedback } from './parts';

/** /admin/content (AD4): What's new, Coming soon and About, edited as plain text. Each part saves on its own. */
export function ContentScreen() {
  return (
    <AdminPage title="What's new, About">
      {(app) => (
        <>
          <WhatsNewEditor saved={app.settings.whatsNew} />
          <ComingSoonEditor saved={app.settings.comingSoon} />
          <AboutEditor saved={app.settings.about} />
        </>
      )}
    </AdminPage>
  );
}

const TODAY = () => new Date().toISOString().slice(0, 10);

/** Save, and "Use built-in text" (deletes the setting so the app shows its own). */
function useSection(key: AppSettingKey, what: string) {
  const save = useSaveSetting();
  const reset = useResetSetting();
  const fb = useFeedback();
  return {
    fb,
    busy: save.isPending || reset.isPending,
    async save(value: unknown, onDone?: () => void) {
      try { await save.mutateAsync({ key, value }); fb.ok(`${what} saved.`); onDone?.(); } catch (err) { fb.fail(saveError(err, what.toLowerCase())); }
    },
    async builtIn(onDone: () => void) {
      try { await reset.mutateAsync(key); fb.ok(`${what} is back to the built-in text.`); onDone(); } catch (err) { fb.fail(saveError(err, what.toLowerCase())); }
    },
  };
}

function WhatsNewEditor({ saved }: { saved: Release[] | null }) {
  const sec = useSection('whatsNew', "What's new");
  const [releases, setReleases] = useState<Release[]>(() => (saved ?? WHATS_NEW).map((r) => ({ ...r, items: [...r.items] })));
  const [custom, setCustom] = useState(saved !== null);
  const [problem, setProblem] = useState<string | null>(null);

  const edit = (i: number, patch: Partial<Release>) => setReleases((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setItem = (i: number, k: number, v: string) => edit(i, { items: releases[i]!.items.map((x, j) => (j === k ? v : x)) });

  async function submit() {
    const cleaned = releases.map((r) => ({ version: r.version.trim(), date: r.date, items: r.items.map((x) => x.trim()).filter(Boolean) }));
    const bad = cleaned.findIndex((r) => !r.version || !r.date);
    if (bad >= 0) { setProblem(`Version ${bad + 1} needs a name and a date.`); sec.fb.fail(`Version ${bad + 1} needs a name and a date.`); return; }
    if (cleaned.some((r) => r.items.length === 0)) { setProblem('Each version needs at least one item.'); sec.fb.fail('Each version needs at least one item.'); return; }
    setProblem(null);
    await sec.save(cleaned, () => { setCustom(true); setReleases(cleaned); });
  }

  return (
    <section aria-labelledby="ct-new" className="group">
      <h2 id="ct-new" className="group__title">What's new</h2>
      <div className="admin-card">
        {!custom && <p className="hint">Showing the built-in text. Saving makes it yours.</p>}
        {releases.map((r, i) => (
          <fieldset key={i} className="admin-release" aria-label={`Version ${r.version || i + 1}`}>
            <div className="admin-field">
              <label htmlFor={`rel-v-${i}`}>Version name</label>
              <input id={`rel-v-${i}`} type="text" value={r.version} maxLength={RELEASE_VERSION_MAX} aria-invalid={problem !== null && !r.version.trim()}
                onChange={(e) => edit(i, { version: e.target.value })} />
            </div>
            <div className="admin-field">
              <label htmlFor={`rel-d-${i}`}>Date</label>
              <input id={`rel-d-${i}`} type="date" value={r.date} onChange={(e) => edit(i, { date: e.target.value })} />
            </div>
            <span className="admin-field__label">{r.items.length === 1 ? '1 item' : `${r.items.length} items`}</span>
            {r.items.map((item, k) => (
              <div key={k} className="admin-itemrow">
                <div className="admin-field">
                  <label className="sr-only" htmlFor={`rel-i-${i}-${k}`}>Item {k + 1} of version {r.version || i + 1}</label>
                  <input id={`rel-i-${i}-${k}`} type="text" value={item} maxLength={ITEM_MAX} onChange={(e) => setItem(i, k, e.target.value)} />
                </div>
                <Button compact aria-label={`Remove item ${k + 1} of version ${r.version || i + 1}`} onClick={() => edit(i, { items: r.items.filter((_, j) => j !== k) })}>Remove</Button>
              </div>
            ))}
            <div className="admin-actions">
              <Button compact disabled={r.items.length >= RELEASE_ITEMS_MAX} aria-label={`Add item to version ${r.version || i + 1}`} onClick={() => edit(i, { items: [...r.items, ''] })}>Add item</Button>
              <Button compact aria-label={`Remove version ${r.version || i + 1}`} onClick={() => setReleases((rs) => rs.filter((_, j) => j !== i))}>Remove version</Button>
            </div>
          </fieldset>
        ))}
        <div className="admin-actions">
          <Button disabled={releases.length >= WHATS_NEW_MAX_RELEASES} onClick={() => setReleases((rs) => [{ version: '', date: TODAY(), items: [''] }, ...rs])}>Add version</Button>
        </div>
        <Result fb={sec.fb.fb} />
        <div className="admin-actions">
          <Button variant="primary" disabled={sec.busy} onClick={() => void submit()}>Save what's new</Button>
          <Button disabled={sec.busy || !custom} onClick={() => void sec.builtIn(() => { setCustom(false); setReleases(WHATS_NEW.map((r) => ({ ...r, items: [...r.items] }))); })}>Use built-in text</Button>
        </div>
      </div>
    </section>
  );
}

function ComingSoonEditor({ saved }: { saved: string[] | null }) {
  const sec = useSection('comingSoon', 'Coming soon');
  const [lines, setLines] = useState<string[]>(() => [...(saved ?? COMING_SOON)]);
  const [custom, setCustom] = useState(saved !== null);
  return (
    <section aria-labelledby="ct-soon" className="group">
      <h2 id="ct-soon" className="group__title">Coming soon</h2>
      <div className="admin-card">
        {!custom && <p className="hint">Showing the built-in text. Saving makes it yours.</p>}
        {lines.map((line, i) => (
          <div key={i} className="admin-itemrow">
            <div className="admin-field">
              <label className="sr-only" htmlFor={`soon-${i}`}>Coming soon line {i + 1}</label>
              <input id={`soon-${i}`} type="text" value={line} maxLength={ITEM_MAX} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
            <Button compact aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <div className="admin-actions">
          <Button disabled={lines.length >= COMING_SOON_MAX} onClick={() => setLines((ls) => [...ls, ''])}>Add line</Button>
        </div>
        <Result fb={sec.fb.fb} />
        <div className="admin-actions">
          <Button variant="primary" disabled={sec.busy} onClick={() => {
            const cleaned = lines.map((l) => l.trim()).filter(Boolean);
            void sec.save(cleaned, () => { setCustom(true); setLines(cleaned); });
          }}>Save coming soon</Button>
          <Button disabled={sec.busy || !custom} onClick={() => void sec.builtIn(() => { setCustom(false); setLines([...COMING_SOON]); })}>Use built-in text</Button>
        </div>
      </div>
    </section>
  );
}

function AboutEditor({ saved }: { saved: string | null }) {
  const sec = useSection('about', 'About');
  const [text, setText] = useState(saved ?? '');
  const id = useId();
  const count = useId();
  return (
    <section aria-labelledby="ct-about" className="group">
      <h2 id="ct-about" className="group__title">About</h2>
      <div className="admin-card">
        <div className="admin-field">
          <label htmlFor={id}>About text</label>
          <textarea id={id} rows={6} value={text} aria-describedby={`${count} ${id}-hint`} onChange={(e) => setText(e.target.value)} />
          <Count id={count} n={text.length} max={ABOUT_MAX} />
          <span id={`${id}-hint`} className="hint">Leave a blank line between paragraphs. Empty shows the built-in welcome note.</span>
        </div>
        <Result fb={sec.fb.fb} />
        <div className="admin-actions">
          <Button variant="primary" disabled={sec.busy} onClick={() => {
            if (text.length > ABOUT_MAX) { sec.fb.fail(`Keep it to ${ABOUT_MAX} characters.`); return; }
            if (!text.trim()) { void sec.builtIn(() => setText('')); return; }
            void sec.save(text.trim());
          }}>Save about</Button>
          <Button disabled={sec.busy || saved === null} onClick={() => void sec.builtIn(() => setText(''))}>Use built-in text</Button>
        </div>
      </div>
    </section>
  );
}
