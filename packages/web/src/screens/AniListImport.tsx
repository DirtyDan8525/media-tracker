import { AniListError, lookupAniList, type AniListImportPreview, type Category, type FetchDeps, type ImportPreview } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { useAllEntries } from '../data/useEntries';
import { Button } from '../design/components/Button';

const NAME_RE = /^[A-Za-z0-9_]{2,20}$/;
const LISTS: Category[] = ['anime', 'manga'];
// AniList blocks Cloudflare's IPs, so this device asks it directly (same as the lookups: lookup/device.ts).
// Called as a plain function: a detached window.fetch throws "Illegal invocation".
const deps: FetchDeps = { fetch: (input, init) => fetch(input, init) };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Look = { k: 'idle' } | { k: 'loading' } | { k: 'error'; message: string } | { k: 'found'; found: AniListImportPreview };

/** The message to show for a failed lookup. */
const errorMessage = (err: unknown): string =>
  err instanceof AniListError ? err.message : "Couldn't reach AniList. Try again in a minute.";

/** Import from AniList: username → Look up → summary with Anime / Manga checkboxes → hands the rows to the shared import flow. */
export function AniListImport({ onImport }: { onImport: (preview: ImportPreview) => void }) {
  const ids = useId();
  const [name, setName] = useState('');
  const [look, setLook] = useState<Look>({ k: 'idle' });
  const mine = useAllEntries(LISTS);
  const [pick, setPick] = useState({ anime: true, manga: true });

  async function lookUp(e: FormEvent) {
    e.preventDefault();
    const user = name.trim();
    if (!NAME_RE.test(user)) {
      setLook({ k: 'error', message: 'AniList names are 2 to 20 letters, digits or underscores.' });
      return;
    }
    setLook({ k: 'loading' });
    try {
      // Titles already on the lists (same AniList id, or same title in that list) are left out.
      const existing = LISTS.flatMap((c) => mine.data[c] ?? []);
      const found = await lookupAniList(user, existing, deps);
      setPick({ anime: true, manga: true });
      setLook({ k: 'found', found });
    } catch (err) {
      setLook({ k: 'error', message: errorMessage(err) });
    }
  }

  const found = look.k === 'found' ? look.found : null;
  const n = found ? (pick.anime ? found.counts.anime : 0) + (pick.manga ? found.counts.manga : 0) : 0;
  const skipped = found ? found.skipped.anime + found.skipped.manga : 0;

  function go() {
    if (!found || n === 0) return;
    const rows = found.rows.filter((r) => (r.category === 'anime' ? pick.anime : r.category === 'manga' && pick.manga));
    onImport({
      rows,
      counts: { anime: rows.filter((r) => r.category === 'anime').length, manga: rows.filter((r) => r.category === 'manga').length },
      skipped: [],
      warnings: [],
      settings: null,
    });
  }

  return (
    <section className="import__panel" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>Import from AniList</h2>
      <p className="muted">Works for public AniList profiles; no AniList sign-in needed. Nothing is saved until you press Import.</p>
      <form className="anilist__form" onSubmit={(e) => void lookUp(e)}>
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-user`}>AniList username</label>
          <input
            id={`${ids}-user`}
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
          {skipped > 0 && <p className="muted">{skipped} already on your lists — skipped</p>}
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
          <Button variant="primary" disabled={n === 0} onClick={go}>Import {plural(n, 'title', 'titles')}</Button>
          <p className="import__note">You can undo the whole import afterwards.</p>
        </div>
      )}
    </section>
  );
}
