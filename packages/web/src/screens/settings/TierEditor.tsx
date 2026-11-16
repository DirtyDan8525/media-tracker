import { DEFAULT_TIERS, tiersFor, validateTierSet, type Category, type TierSet } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { saveTiers } from '../../data/ratings';
import { Button } from '../../design/components/Button';
import { TIERS_TOP_FIRST } from '../../design/components/TierPicker';
import { useToast } from '../../design/components/Toast';
import { enabledLists, LIST_LABEL } from '../../nav';
import { PageHeader } from '../../shell/PageHeader';
import { useSessionMe } from '../../shell/SessionGate';
import '../../design/settings.css';

export const TIER_SAVE_FAILED = "Couldn't save the tiers. Try again.";
const E_WIDTH = 'Each tier needs at least 0.5';
const E_SAME = 'Names must be different';
const E_DECIMAL = 'One decimal';
const E_NAME = 'Use 1 to 20 characters';
const E_NUMBER = 'Enter a number';

/** What is typed: names indexed by tier, and the "from" boxes of tiers 1..3 as text. */
interface Draft { names: string[]; from: [string, string, string] }

const toDraft = (t: TierSet): Draft => ({ names: [...t.names], from: [t.bounds[0].toFixed(1), t.bounds[1].toFixed(1), t.bounds[2].toFixed(1)] });

/** Tenths of a point, or an error for the box. */
function parseFrom(text: string): { tenths: number } | { error: string } {
  const t = text.trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return { error: E_NUMBER };
  const n = Number(t);
  if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) return { error: E_DECIMAL };
  return { tenths: Math.round(n * 10) };
}

/** Each invalid field's own message, keyed "name0".."name3" and "from1".."from3". */
function fieldErrors(d: Draft): Record<string, string> {
  const out: Record<string, string> = {};
  const trimmed = d.names.map((n) => n.trim());
  const seen = trimmed.map((n) => n.toLocaleLowerCase());
  trimmed.forEach((n, t) => {
    if (n.length < 1 || n.length > 20) out[`name${t}`] = E_NAME;
    else if (seen.filter((x) => x === seen[t]).length > 1) out[`name${t}`] = E_SAME;
  });
  const parsed = d.from.map(parseFrom);
  parsed.forEach((p, i) => { if ('error' in p) out[`from${i + 1}`] = p.error; });
  if (parsed.every((p) => 'tenths' in p)) {
    const [b1, b2, b3] = parsed.map((p) => (p as { tenths: number }).tenths) as [number, number, number];
    // Each tier's width belongs to its own "from" box (Didn't like's, which can't be edited, to Fine's).
    if (b1 < 5 || b2 - b1 < 5) out.from1 = E_WIDTH;
    if (b3 - b2 < 5) out.from2 = E_WIDTH;
    if (100 - b3 < 5) out.from3 = E_WIDTH;
  }
  return out;
}

function draftToSet(d: Draft): TierSet | null {
  return validateTierSet({ names: d.names, bounds: d.from.map((f) => Number(f)) });
}

/** Settings → Rating tiers (route /settings/tiers): rename a list's four tiers and move their boundaries. */
export function TierEditor() {
  const me = useSessionMe();
  const lists = enabledLists(me.settings);
  const [picked, setPicked] = useState<Category | null>(null);
  const list = picked && lists.includes(picked) ? picked : lists[0] ?? null;
  const saved = list ? tiersFor(me.settings, list) : DEFAULT_TIERS;
  return (
    <div className="screen">
      <PageHeader title="Rating tiers" sub="Each list has its own four tiers." backTo="/settings/appearance" backUsesHistory />
      <div className="screen__body stack-10">
        {list === null
          ? <p className="field-hint">Turn a list on in Settings to set its tiers.</p>
          : (
            <>
              <div role="group" aria-label="Lists" className="cmp-chips">
                {lists.map((c) => (
                  <Button key={c} variant="chip" active={c === list} onClick={() => setPicked(c)}>{LIST_LABEL[c]}</Button>
                ))}
              </div>
              <TierForm key={list} list={list} saved={saved} />
            </>
          )}
      </div>
    </div>
  );
}

function TierForm({ list, saved }: { list: Category; saved: TierSet }) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(draft);
  const set = Object.keys(errors).length === 0 ? draftToSet(draft) : null;
  const changed = set !== null && (JSON.stringify(set) !== JSON.stringify(saved));

  const done = (ok: boolean, next?: TierSet) => {
    setBusy(false);
    if (!ok) { toast.show(TIER_SAVE_FAILED); return; }
    if (next) setDraft(toDraft(next));
    toast.show(`Tiers saved. Scores on ${LIST_LABEL[list]} spread over the new ranges.`);
  };
  const onSave = async () => {
    if (!set || busy) return;
    setBusy(true);
    done(await saveTiers(qc, list, set), set);
  };
  const onReset = async () => {
    if (busy) return;
    setBusy(true);
    done(await saveTiers(qc, list, null), DEFAULT_TIERS);
  };

  const setName = (t: number, v: string) => setDraft((d) => ({ ...d, names: d.names.map((n, i) => (i === t ? v : n)) }));
  const setFrom = (i: number, v: string) => setDraft((d) => ({ ...d, from: d.from.map((f, j) => (j === i ? v : f)) as Draft['from'] }));

  return (
    <>
      <div className="group__card tier-editor__rows">
        {TIERS_TOP_FIRST.map((t) => {
          const key = `${id}-${t}`;
          const nameErr = errors[`name${t}`];
          const fromErr = t > 0 ? errors[`from${t}`] : undefined;
          const label = saved.names[t]!;
          return (
            <div key={t} className="tier-editor__row">
              <div className="tier-editor__line">
                <input className="input" type="text" aria-label={`${label} name`} value={draft.names[t]} maxLength={40}
                  aria-invalid={nameErr ? true : undefined} aria-describedby={nameErr ? `${key}-name-err` : undefined}
                  onChange={(e) => setName(t, e.target.value)} />
                <label className="tier-editor__from">
                  <span aria-hidden="true">from</span>
                  <input className="input" type="text" inputMode="decimal" aria-label={`${label} from`}
                    value={t === 0 ? '0' : draft.from[t - 1]} disabled={t === 0}
                    aria-invalid={fromErr ? true : undefined} aria-describedby={fromErr ? `${key}-from-err` : undefined}
                    onChange={(e) => setFrom(t - 1, e.target.value)} />
                </label>
              </div>
              {t === 3 && <p className="tier-editor__to">to 10</p>}
              {nameErr && <span id={`${key}-name-err`} className="field-error">{nameErr}</span>}
              {fromErr && <span id={`${key}-from-err`} className="field-error">{fromErr}</span>}
            </div>
          );
        })}
      </div>
      <p className="field-hint">
        Changing a boundary moves no titles between tiers; their scores spread over the new range.
        {(list === 'anime' || list === 'tv') && ' Seasons use these tiers too.'}
      </p>
      <div className="tier-editor__actions">
        <Button onClick={() => void onReset()} disabled={busy}>Reset to defaults</Button>
        <Button variant="primary" onClick={() => void onSave()} disabled={!changed || busy}>Save</Button>
      </div>
    </>
  );
}
