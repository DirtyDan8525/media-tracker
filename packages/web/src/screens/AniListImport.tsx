import { AniListError, lookupAniList, type AniListLookup, type Category, type Entry, type FetchDeps, type ImportPreview } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { useAllEntries } from '../data/useEntries';
import { Button } from '../design/components/Button';
import { aniListUpdates, type AfterImport, type ConflictChoice } from '../import/aniListUpdate';
import { AniListConflicts } from './AniListConflicts';

const NAME_RE = /^[A-Za-z0-9_]{2,20}$/;
const LISTS: Category[] = ['anime', 'manga'];
// AniList blocks Cloudflare's IPs, so this device asks it directly (same as the lookups: lookup/device.ts).
// Called as a plain function: a detached window.fetch throws "Illegal invocation".
const deps: FetchDeps = { fetch: (input, init) => fetch(input, init) };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Look = { k: 'idle' } | { k: 'loading' } | { k: 'error'; message: string } | { k: 'found'; found: AniListLookup<Entry> };

/** The message to show for a failed lookup. */
const errorMessage = (err: unknown): string =>
  err instanceof AniListError ? err.message : "Couldn't reach AniList. Try again in a minute.";

/** Import from AniList: username → Look up → summary with Anime / Manga checkboxes → hands the rows to the shared import flow. */
export function AniListImport({ onImport }: { onImport: (preview: ImportPreview, after?: AfterImport) => void }) {
  const ids = useId();
  const [name, setName] = useState('');
  const [look, setLook] = useState<Look>({ k: 'idle' });
  const qc = useQueryClient();
  const mine = useAllEntries(LISTS);
  const [choices, setChoices] = useState<ConflictChoice[]>([]);
  const [review, setReview] = useState(false);
  const [pick, setPick] = useState({ anime: true, manga: true });
  // More → "Import from AniList" links to /import#anilist: bring this panel into view, ready to type.
  const { hash } = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (hash !== '#anilist') return;
    sectionRef.current?.scrollIntoView?.({ block: 'start' });
    inputRef.current?.focus({ preventScroll: true });
  }, [hash]);

  async function lookUp(e: FormEvent) {
    e.preventDefault();
    const user = name.trim();
    if (!NAME_RE.test(user)) {
      setLook({ k: 'error', message: 'AniList names are 2 to 20 letters, digits or underscores.' });
      return;
    }
    setLook({ k: 'loading' });
    try {
      // Titles already on the lists (same id, same name, or a close name) come back as matches to review.
      const existing = LISTS.flatMap((c) => mine.data[c] ?? []);
      const found = await lookupAniList(user, existing, deps);
      setPick({ anime: true, manga: true });
      setChoices(found.matches.map(() => 'mine'));
      setReview(false);
      setLook({ k: 'found', found });
    } catch (err) {
      setLook({ k: 'error', message: errorMessage(err) });
    }
  }

  const found = look.k === 'found' ? look.found : null;
  const picked = (c: Category) => (c === 'anime' ? pick.anime : c === 'manga' && pick.manga);
  const matches = found ? found.matches.map((m, i) => ({ m, i })).filter(({ m }) => picked(m.row.category)) : [];
  const sameN = matches.filter(({ m }) => m.kind === 'same').length;
  const maybeN = matches.length - sameN;
  const choice = (i: number): ConflictChoice => choices[i] ?? 'mine';
  const addMatches = matches.filter(({ i }) => choice(i) === 'both');
  const updateMatches = matches.filter(({ i }) => choice(i) === 'anilist');
  const newN = found ? (pick.anime ? found.counts.anime : 0) + (pick.manga ? found.counts.manga : 0) : 0;
  const n = newN + addMatches.length;

  function setAll(c: ConflictChoice) {
    // "Use AniList for all" covers only the clear same-title ones; possible matches are never bulk-changed.
    setChoices((prev) => (found?.matches ?? []).map((m, i) => (c === 'mine' || m.kind === 'same' ? c : (prev[i] ?? 'mine'))));
  }

  function go() {
    if (!found || (n === 0 && updateMatches.length === 0)) return;
    const rows = [
      ...found.rows.filter((r) => picked(r.category)),
      ...addMatches.map(({ m }) => m.row),
    ];
    const after = updateMatches.length > 0 ? aniListUpdates(qc, updateMatches.map(({ m }) => ({ mine: m.existing, row: m.row }))) : undefined;
    onImport({
      rows,
      counts: { anime: rows.filter((r) => r.category === 'anime').length, manga: rows.filter((r) => r.category === 'manga').length },
      skipped: [],
      warnings: [],
      settings: null,
    }, after);
  }

  return (
    <section id="anilist" ref={sectionRef} className="import__panel" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>Import from AniList</h2>
      <p className="muted">Works for public AniList profiles; no AniList sign-in needed. Nothing is saved until you press Import.</p>
      <form className="anilist__form" onSubmit={(e) => void lookUp(e)}>
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-user`}>AniList username</label>
          <input
            id={`${ids}-user`}
            ref={inputRef}
            className="input"
            value={name}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={20}
            onChange={(e) => { setName(e.target.value); if (look.k !== 'loading') setLook({ k: 'idle' }); }}
          />
        </div>
        <Button type="submit" variant="primary" disabled={look.k === 'loading' || name.trim() === '' || mine.isPending}>Look up</Button>
      </form>
      {look.k === 'loading' && <p role="status" className="muted">Looking up your lists…</p>}
      {look.k === 'error' && <p role="alert" className="field-error">{look.message}</p>}
      {found && (
        <div className="anilist__found" role="group" aria-label={`Found on AniList for ${found.user}`}>
          <p><strong>Anime {found.counts.anime}</strong> · <strong>Manga {found.counts.manga}</strong></p>
          {matches.length > 0 && (
            <>
              <p role="status">
                {newN} new · {sameN} already on your list{maybeN > 0 ? ` · ${plural(maybeN, 'possible match', 'possible matches')}` : ''}
              </p>
              <div>
                <Button onClick={() => setReview(true)}>Review</Button>
                {matches.some(({ i }) => choice(i) !== 'mine') && (
                  <span className="muted"> {updateMatches.length} to update · {addMatches.length} to add separately</span>
                )}
              </div>
            </>
          )}
          <p className="muted">Scores are on your 0–10 scale. Status, progress, notes and start/finish dates are kept; private entries stay private.</p>
          <div className="anilist__checks">
            {(['anime', 'manga'] as const).map((c) => (
              <label key={c} className="anilist__check">
                <input
                  type="checkbox"
                  checked={pick[c] && found.counts[c] > 0}
                  disabled={found.counts[c] === 0}
                  onChange={(e) => setPick((p) => ({ ...p, [c]: e.target.checked }))}
                />
                {c === 'anime' ? 'Anime' : 'Manga'}
              </label>
            ))}
          </div>
          <Button variant="primary" disabled={n === 0 && updateMatches.length === 0} onClick={go}>
            {n === 0 && updateMatches.length > 0 ? `Update ${plural(updateMatches.length, 'title', 'titles')}` : `Import ${plural(n, 'title', 'titles')}`}
          </Button>
          <p className="import__note">You can undo the whole import afterwards.{updateMatches.length > 0 && ' Updates to titles you already had can\'t be undone with Undo.'}</p>
        </div>
      )}
      {found && (
        <AniListConflicts
          open={review}
          matches={found.matches}
          choices={found.matches.map((_, i) => choice(i))}
          onChoice={(i, c) => setChoices((p) => found.matches.map((_, j) => (j === i ? c : (p[j] ?? 'mine'))))}
          onAll={setAll}
          onClose={() => setReview(false)}
        />
      )}
    </section>
  );
}
