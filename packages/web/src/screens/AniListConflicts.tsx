import { statusLabel, type AniListMatch, type Entry } from '@media-tracker/shared';
import { useId } from 'react';
import { Button } from '../design/components/Button';
import { Sheet } from '../design/components/Sheet';
import type { ConflictChoice } from '../import/aniListUpdate';

export type EntryMatch = AniListMatch<Entry>;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const progressText = (p: number | null | undefined, t: number | null | undefined) =>
  typeof p === 'number' && p > 0 ? (typeof t === 'number' ? `${p} of ${t}` : `${p}`) : '—';

function Side({ heading, rows }: { heading: string; rows: [string, string][] }) {
  return (
    <div className="conflict__side">
      <h4 className="conflict__side-h">{heading}</h4>
      <dl className="conflict__dl">
        {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
    </div>
  );
}

function Card({ m, id, value, onChange }: { m: EntryMatch; id: string; value: ConflictChoice; onChange: (c: ConflictChoice) => void }) {
  const { existing: e, row: r } = m;
  const status = (s: Entry['status']) => (s ? statusLabel(s, e.category) : '—');
  const dates = [r.startedAt && `started ${r.startedAt}`, r.finishedAt && `finished ${r.finishedAt}`].filter(Boolean).join(', ');
  const name = `${id}-choice`;
  const opt = (v: ConflictChoice, label: string) => (
    <label className="conflict__opt">
      <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
      {label}
    </label>
  );
  return (
    <li className="conflict">
      <div className="conflict__cols">
        <Side heading="On your list" rows={[
          ['Title', e.title], ['Rating', e.rating === null ? 'Not rated' : String(e.rating)], ['Status', status(e.status)],
          ['Progress', progressText(e.progress, e.progressTotal)], ['Notes', e.notes.trim() ? clip(e.notes.trim(), 80) : '—'],
        ]} />
        <Side heading="From AniList" rows={[
          ['Title', r.title], ['Score', r.rating === null ? 'No score' : String(r.rating)], ['Status', status(r.status)],
          ['Progress', progressText(r.progress, r.progressTotal)], ['Dates', dates || '—'],
        ]} />
      </div>
      <fieldset className="conflict__choices">
        <legend>What to do with {e.title}</legend>
        {opt('mine', 'Keep mine')}
        {opt('anilist', 'Use AniList')}
        {opt('both', m.kind === 'same' ? 'Add as a separate entry' : 'Keep both')}
      </fieldset>
      {value === 'anilist' && <p className="muted conflict__help">Status, score, progress and dates come from AniList. Your notes stay.</p>}
      {value === 'both' && m.kind === 'same' && <p className="muted conflict__help">This adds a second copy of the title.</p>}
    </li>
  );
}

/** The review sheet: one card per conflict, "Keep mine" by default, with bulk buttons on top. */
export function AniListConflicts({ open, matches, choices, onChoice, onAll, onClose }: {
  open: boolean;
  matches: EntryMatch[];
  choices: ConflictChoice[];
  onChoice: (i: number, c: ConflictChoice) => void;
  onAll: (c: ConflictChoice) => void;
  onClose: () => void;
}) {
  const id = useId();
  const idx = matches.map((_, i) => i);
  const same = idx.filter((i) => matches[i]!.kind === 'same');
  const maybe = idx.filter((i) => matches[i]!.kind === 'possible');
  const list = (is: number[]) => (
    <ul className="plain-list conflict__list">
      {is.map((i) => <Card key={i} m={matches[i]!} id={`${id}-${i}`} value={choices[i] ?? 'mine'} onChange={(c) => onChoice(i, c)} />)}
    </ul>
  );
  return (
    <Sheet open={open} title="Review titles you already have" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="conflict__bulk">
        <Button compact onClick={() => onAll('mine')}>Keep all mine</Button>
        <Button compact onClick={() => onAll('anilist')} disabled={same.length === 0}>Use AniList for all</Button>
      </div>
      <p className="muted">"Use AniList for all" covers the titles that are clearly the same; check the maybes one by one. Updates to titles you already had can't be undone with Undo.</p>
      {same.length > 0 && (<section aria-label="Already on your list"><h3>Already on your list</h3>{list(same)}</section>)}
      {maybe.length > 0 && (<section aria-label="Maybe the same title"><h3>Maybe the same title?</h3>{list(maybe)}</section>)}
    </Sheet>
  );
}
