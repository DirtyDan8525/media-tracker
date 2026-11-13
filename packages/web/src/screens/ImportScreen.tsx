import { type Category, type ImportPreview, type UserSettings } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api/client';
import { useBackfill } from '../backfill/useBackfill';
import { refreshCategories } from '../data/useEntries';
import { useSaveSettings } from '../data/useMe';
import { Button } from '../design/components/Button';
import { ProgressBar } from '../design/components/ProgressBar';
import { chunkRows } from '../import/chunk';
import { parseWorkbook } from '../import/parseWorkbook';
import { LIST_LABEL, LIST_ORDER } from '../nav';
import { PageHeader } from '../shell/PageHeader';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const titles = (n: number) => plural(n, 'title', 'titles');

type Stage =
  | { k: 'choose'; error?: string }
  | { k: 'reading' }
  | { k: 'unreadable'; detail: string }
  | { k: 'preview'; name: string; preview: ImportPreview }
  | { k: 'importing' }
  | { k: 'failed' }
  | { k: 'done' }
  | { k: 'undone'; removed: number };

/** The import in flight: one importId, the rows split into chunks, and how far it got. */
interface Run {
  importId: string;
  preview: ImportPreview;
  chunks: ImportPreview['rows'][];
  next: number;
  sent: number;
}

async function readBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('The file could not be read'));
    r.readAsArrayBuffer(file);
  });
}

const categoriesOf = (p: ImportPreview): Category[] => LIST_ORDER.filter((c) => (p.counts[c] ?? 0) > 0);

function settingsLine(s: Partial<UserSettings>): string {
  const parts: string[] = [];
  if (s.theme) parts.push(`${s.theme} theme`);
  if (s.colors && Object.keys(s.colors).length) parts.push('colors');
  if (s.tabs && Object.keys(s.tabs).length) parts.push('tabs');
  if (['compareAsk', 'compareStyle', 'compareRoom', 'compareWindow'].some((k) => k in s)) parts.push('compare options');
  return parts.join(' · ');
}

/** Only the settings the file actually had. */
function presentSettings(s: Partial<UserSettings> | null): Partial<UserSettings> | null {
  if (!s) return null;
  const out = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as Partial<UserSettings>;
  return Object.keys(out).length ? out : null;
}

/** Import from the Sheet: choose a file → preview → import (in chunks) → done, with Undo. */
export function ImportScreen() {
  const qc = useQueryClient();
  const saveSettings = useSaveSettings();
  const backfill = useBackfill();
  const [stage, setStage] = useState<Stage>({ k: 'choose' });
  const [sent, setSent] = useState(0);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [undoError, setUndoError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [promptOpen, setPromptOpen] = useState(true);
  const [started, setStarted] = useState(false);
  const run = useRef<Run | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setStage({ k: 'choose', error: 'That isn\'t an .xlsx file. In Google Sheets, use File → Download → Microsoft Excel (.xlsx), then choose it here.' });
      return;
    }
    setStage({ k: 'reading' });
    try {
      const preview = await parseWorkbook(await readBuffer(file));
      setStage({ k: 'preview', name: file.name, preview });
    } catch (err) {
      setStage({ k: 'unreadable', detail: err instanceof Error ? err.message : String(err) });
    }
  }

  function begin(preview: ImportPreview) {
    run.current = { importId: crypto.randomUUID(), preview, chunks: chunkRows(preview.rows), next: 0, sent: 0 };
    setSent(0);
    setSettingsFailed(false);
    setPromptOpen(true);
    setStarted(false);
    void proceed();
  }

  /** Sends the remaining chunks one after another; stops at the first failure. */
  async function proceed() {
    const r = run.current;
    if (!r) return;
    setStage({ k: 'importing' });
    while (r.next < r.chunks.length) {
      const rows = r.chunks[r.next]!;
      try {
        // The index makes a retry of a chunk that already landed (lost reply) a no-op on the server.
        await api.post('/api/import', { importId: r.importId, chunk: r.next, rows });
      } catch {
        setStage({ k: 'failed' });
        return;
      }
      r.next++;
      r.sent += rows.length;
      setSent(r.sent);
    }
    const settings = presentSettings(r.preview.settings);
    if (settings) {
      try {
        await saveSettings.mutateAsync(settings);
      } catch {
        setSettingsFailed(true);
      }
    }
    await refreshCategories(qc, categoriesOf(r.preview));
    setStage({ k: 'done' });
  }

  async function undo() {
    const r = run.current;
    if (!r || busy) return;
    setBusy(true);
    setUndoError(false);
    try {
      let removed = 0;
      try {
        removed = (await api.del<{ deleted: number }>(`/api/import/${r.importId}`))?.deleted ?? 0;
      } catch (err) {
        // 404: nothing of this import reached the server (the first chunk failed), so there is nothing to remove.
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
      await refreshCategories(qc, categoriesOf(r.preview));
      setStage({ k: 'undone', removed });
    } catch {
      setUndoError(true);
    } finally {
      setBusy(false);
    }
  }

  const total = run.current?.preview.rows.length ?? 0;

  return (
    <div className="screen">
      <PageHeader title="Import your Sheet" backTo="/more" />
      <div className="screen__body import">
        {stage.k === 'choose' && (
          <div className="import__panel">
            <h2>Choose your Sheet</h2>
            <p className="muted">In Google Sheets, use File → Download → Microsoft Excel (.xlsx), then choose that file here. Nothing is saved until you press Import.</p>
            {stage.error && <p role="alert" className="field-error">{stage.error}</p>}
            <label className="btn btn--primary file-pick">
              Choose your Sheet file
              <input type="file" className="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void onFile(e)} />
            </label>
          </div>
        )}

        {stage.k === 'reading' && <p role="status" className="muted">Reading your Sheet…</p>}

        {stage.k === 'unreadable' && (
          <div className="import__panel">
            <h2>Couldn't read this file</h2>
            <p className="muted">Make sure it's an Excel (.xlsx) download of your Sheet. Details: {stage.detail}</p>
            <div className="import__actions">
              <Button variant="primary" onClick={() => setStage({ k: 'choose' })}>Choose another file</Button>
            </div>
          </div>
        )}

        {stage.k === 'preview' && <Preview name={stage.name} preview={stage.preview} onChange={() => setStage({ k: 'choose' })} onImport={() => begin(stage.preview)} />}

        {stage.k === 'importing' && (
          <div className="import__panel">
            <h2>Importing…</h2>
            <ProgressBar label="Import progress" value={sent} max={total} />
            <p className="muted" role="status">{sent} of {titles(total)}</p>
          </div>
        )}

        {stage.k === 'failed' && (
          <div className="import__panel">
            <h2>Import stopped</h2>
            <p>Something went wrong. {sent} of {titles(total)} were imported before it stopped.</p>
            <p className="muted">You can try the rest again, or undo the import to remove what was added.</p>
            {undoError && <p role="alert" className="field-error">Couldn't undo. Try again.</p>}
            <div className="import__actions">
              <Button variant="primary" onClick={() => void proceed()} disabled={busy}>Try the rest again</Button>
              <Button onClick={() => void undo()} disabled={busy}>Undo import</Button>
            </div>
          </div>
        )}

        {stage.k === 'done' && (
          <>
            <div className="import__panel">
              <h2>Imported {titles(sent)}</h2>
              <p className="muted">They're on your lists now. Nothing was shared with anyone.</p>
              {settingsFailed && <p role="alert" className="field-error">Your Sheet's settings couldn't be saved. You can set them again in Settings.</p>}
              {undoError && <p role="alert" className="field-error">Couldn't undo. Try again.</p>}
              <div className="import__actions">
                <Button onClick={() => void undo()} disabled={busy}>Undo import</Button>
                <Link to="/" className="btn btn--ghost">Go to my lists</Link>
              </div>
            </div>
            {sent > 0 && promptOpen && !started && (
              <div className="import__panel" role="group" aria-labelledby="fill-prompt">
                <h2 id="fill-prompt">Fill in details for {plural(sent, 'imported title', 'imported titles')}?</h2>
                <p className="muted">Covers, descriptions and dates are looked up one title at a time while the app is open. You can pause any time in Settings.</p>
                <div className="import__actions">
                  <Button variant="primary" onClick={() => { backfill.start(); setStarted(true); }}>Start</Button>
                  <Button onClick={() => setPromptOpen(false)}>Not now</Button>
                </div>
              </div>
            )}
            {started && (
              <p className="import__note" role="status">Filling in details. <Link to="/settings">See progress in Settings</Link></p>
            )}
          </>
        )}

        {stage.k === 'undone' && (
          <div className="import__panel">
            <h2>Import undone</h2>
            <p className="muted">{stage.removed > 0 ? `${titles(stage.removed)} removed.` : 'Nothing was added.'}</p>
            <div className="import__actions">
              <Button variant="primary" onClick={() => setStage({ k: 'choose' })}>Choose a file</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Preview({ name, preview, onChange, onImport }: { name: string; preview: ImportPreview; onChange: () => void; onImport: () => void }) {
  const n = preview.rows.length;
  const settings = preview.settings && settingsLine(preview.settings);
  return (
    <>
      <div className="import__file">
        <div className="import__file-text">
          <span className="import__file-name">{name}</span>
          <span className="import__file-hint">Nothing is saved until you press Import</span>
        </div>
        <Button compact onClick={onChange}>Change</Button>
      </div>

      <section aria-label="What will be imported" className="group__card">
        <ul className="plain-list import__counts">
          {LIST_ORDER.filter((c) => (preview.counts[c] ?? 0) > 0).map((c) => (
            <li key={c} className="import__count"><span>{LIST_LABEL[c]}</span><strong>{preview.counts[c]}</strong></li>
          ))}
        </ul>
        {settings && (
          <div className="import__count import__count--settings"><span>Settings</span><span>{settings}</span></div>
        )}
      </section>

      {preview.warnings.length > 0 && (
        <details className="import__details import__details--warn">
          <summary>{plural(preview.warnings.length, 'warning', 'warnings')}</summary>
          <ul className="plain-list">
            {preview.warnings.map((w, i) => <li key={i}>{`${w.tab}, row ${w.row}: ${w.message}`}</li>)}
          </ul>
        </details>
      )}
      {preview.skipped.length > 0 && (
        <details className="import__details">
          <summary>{plural(preview.skipped.length, 'row skipped', 'rows skipped')}</summary>
          <ul className="plain-list">
            {preview.skipped.map((s, i) => <li key={i}>{`${s.tab}, row ${s.row}: ${s.reason}`}</li>)}
          </ul>
        </details>
      )}

      {n === 0 && <p role="status" className="muted">No titles were found in this file.</p>}
      <Button variant="primary" className="import__go" disabled={n === 0} onClick={onImport}>Import {titles(n)}</Button>
      <p className="import__note">You can undo the whole import afterwards.</p>
    </>
  );
}
