import { CATEGORY_CONFIG, type Category } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import type { SourceCheck } from '../../api/adminTypes';
import { useCheckSources, useExplainLookup } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { LIST_LABEL, LIST_ORDER } from '../../nav';
import { PlainPage, Result, useFeedback } from './parts';

/** A source slower than this (ms) is flagged "Slow" even though it answered. */
export const SLOW_MS = 2000;

export function statusOf(c: SourceCheck): { word: string; cls: string } {
  if (c.ok === null) return { word: 'Not set up', cls: 'off' };
  if (!c.ok) return { word: 'Failing', cls: 'bad' };
  return c.ms >= SLOW_MS ? { word: 'Slow', cls: 'slow' } : { word: 'OK', cls: 'ok' };
}

/** /admin/lookup (AD8): Check sources, and "Why didn't it find this?". */
export function LookupToolsScreen() {
  return (
    <PlainPage title="Lookup tools">
      <CheckSources />
      <WhyNot />
    </PlainPage>
  );
}

function CheckSources() {
  const check = useCheckSources();
  const fb = useFeedback();
  async function run() {
    try { await check.mutateAsync(); } catch { fb.fail("Couldn't run the checks. Check your connection and try again."); }
  }
  return (
    <section aria-labelledby="lk-check" className="group">
      <h2 id="lk-check" className="group__title">Check sources</h2>
      <div className="admin-card">
        <Button variant="primary" disabled={check.isPending} onClick={() => void run()}>{check.isPending ? 'Checking…' : 'Check sources'}</Button>
        <Result fb={fb.fb} />
        {check.data && (
          <ul className="plain-list" aria-label="Source results">
            {check.data.map((c) => {
              const s = statusOf(c);
              return (
                <li key={c.label} className="admin-check">
                  <span className="admin-check__name">{c.label}</span>
                  <span className={`admin-status admin-status--${s.cls}`}>{s.word}</span>
                  {c.ok !== null && <span className="muted">{c.ms} ms</span>}
                  {c.error && <span className="admin-check__note">{c.error}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function WhyNot() {
  const explain = useExplainLookup();
  const fb = useFeedback();
  const [category, setCategory] = useState<Category>('anime');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const ids = { cat: useId(), title: useId(), err: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr('Type the title to look up.'); return; }
    setErr(null);
    try { await explain.mutateAsync({ category, title: title.trim() }); } catch { fb.fail("Couldn't run the lookup. Check your connection and try again."); }
  }
  const r = explain.data;
  return (
    <section aria-labelledby="lk-why" className="group">
      <h2 id="lk-why" className="group__title">Why didn't it find this?</h2>
      <form className="admin-card" onSubmit={(e) => void submit(e)} noValidate>
        <div className="admin-field">
          <label htmlFor={ids.cat}>List</label>
          <select id={ids.cat} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {LIST_ORDER.filter((c) => c in CATEGORY_CONFIG).map((c) => <option key={c} value={c}>{LIST_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="admin-field">
          <label htmlFor={ids.title}>Title</label>
          <input id={ids.title} type="text" value={title} aria-invalid={!!err} aria-describedby={err ? ids.err : undefined}
            onChange={(e) => { setTitle(e.target.value); setErr(null); }} />
          {err && <span id={ids.err} role="alert" className="field-error">{err}</span>}
        </div>
        <Result fb={fb.fb} />
        <div className="admin-actions"><Button type="submit" variant="primary" disabled={explain.isPending}>{explain.isPending ? 'Looking…' : 'Explain the lookup'}</Button></div>
        {r && (
          <div role="status" aria-label="Lookup steps">
            {r.steps.length === 0 ? <p className="hint">The lookup tried nothing.</p> : (
              <ol className="admin-steps">
                {r.steps.map((s, i) => (
                  <li key={i}>
                    <b>{s.source}</b> “{s.query}” → {s.results === 1 ? '1 result' : `${s.results} results`}
                    {s.chosen ? ` · chose “${s.chosen}”` : ''}{s.reason ? ` · ${s.reason}` : ''}
                  </li>
                ))}
              </ol>
            )}
            <p><b>{r.found ? `Result: “${r.found}”` : 'Nothing matched.'}</b></p>
            {r.cached && <p className="hint">A normal lookup would return “{r.cached}” from the cache instead.</p>}
          </div>
        )}
      </form>
    </section>
  );
}
