import {
  CATEGORY_CONFIG, ORIGIN_LABEL, PLAN_STATUS, PROGRESS_CATEGORIES, PROGRESS_MAX, clampProgress, showsProgress, STATUSES, formatRating, sourceUrl, statusLabel, type Entry, type LookupInfo, type Status,
} from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api/client';
import { removeEntryFromCache } from '../data/entryCache';
import { refetchAfterDelete, retryOnConflict } from '../data/ratings';
import { SAVE_FAILED, saveEntryChange } from '../data/entryMutations';
import { useEntry } from '../data/useEntry';
import { Button } from '../design/components/Button';
import { CountUp } from '../design/components/CountUp';
import { CoverBackdrop } from '../design/components/CoverBackdrop';
import { CoverImage } from '../design/components/CoverImage';
import { RatingBadge } from '../design/components/RatingBadge';
import { EmptyState } from '../design/components/EmptyState';
import { Sheet } from '../design/components/Sheet';
import { closestFirst } from '../hooks/useAddEntry';
import { applyLookupMatch } from '../lookup/apply';
import { runLookup } from '../lookup/run';
import { PickerSheet } from './PickerSheet';
import { Skeleton } from '../design/components/Skeleton';
import { useToast } from '../design/components/Toast';
import { parseRating } from '../lists/validate';
import { buildLookupQuery, isHttpUrl } from '../lookup/query';
import { refetchEntry } from '../lookup/refetch';
import { LIST_LABEL, seasonsEnabled } from '../nav';
import { BackButton } from '../shell/BackButton';
import { recFromEntry } from '../data/messages';
import { ShareButton } from './messages/ShareButton';
import { useSessionMe } from '../shell/SessionGate';
import { ProgressControl } from './list/ProgressControl';
import { DetailField } from './entry/DetailField';
import { SeasonsEditor } from './entry/SeasonsEditor';
import { useCloseCall } from './sharpen/CloseCallSheet';
import { EntrySocial } from './social/EntrySocial';
import '../design/feed.css';

const DATE_RE = /^(\d{4}|\d{4}-\d{2}-\d{2})$/;

/** A switch with its own explanation underneath (EntryPrivacy.wf). The note describes the switch. */
function PrivacySwitch({ id, label, note, checked, onChange }: {
  id: string; label: string; note: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="switch-row switch-row--detail privacy-row">
      <input type="checkbox" role="switch" checked={checked} aria-labelledby={`${id}-l`} aria-describedby={`${id}-n`}
        onChange={(e) => onChange(e.target.checked)} />
      <span className="privacy-row__text">
        <span id={`${id}-l`} className="privacy-row__label">{label}</span>
        <span id={`${id}-n`} className="privacy-row__note">{note}</span>
      </span>
    </label>
  );
}

export function EntryDetail() {
  const { id = '' } = useParams();
  const { data: entry, isPending, error } = useEntry(id);
  if (!entry) {
    if (isPending) {
      return (
        <div className="screen" aria-busy="true" aria-label="Loading">
          <div className="screen__body detail"><Skeleton height={180} /><Skeleton height={26} width="60%" /><Skeleton height={80} /></div>
        </div>
      );
    }
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="screen">
        <div className="screen__body">
          <EmptyState icon="info" title={missing ? "We couldn't find that entry" : "Couldn't load this entry"}
            body={missing ? 'It may have been deleted.' : 'Check your connection and try again.'} />
          <p className="center"><Link to="/">Back to your lists</Link></p>
        </div>
      </div>
    );
  }
  return <DetailBody key={entry.id} entry={entry} />;
}

function DetailBody({ entry }: { entry: Entry }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const me = useSessionMe();
  const cfg = CATEGORY_CONFIG[entry.category];
  const uid = useId();
  const statusId = useId();
  const [expanded, setExpanded] = useState(false);
  const [sheet, setSheet] = useState<'refetch' | 'delete' | null>(null);

  const save = (patch: Partial<Entry>) => void saveEntryChange(qc, entry, patch, () => toast.show(SAVE_FAILED));
  // A retyped number is the truth (N1); once saved, ask about close ratings (N6).
  const { ask: askClose, element: closeCallSheet } = useCloseCall();
  const saveRating = async (rating: number | null) => {
    const saved = await saveEntryChange(qc, entry, { rating }, () => toast.show(SAVE_FAILED));
    if (saved && saved.rating !== null) void askClose(saved.category, saved.id);
  };
  const typedNow = entry.typed ?? entry.rating;
  const planned = entry.status === PLAN_STATUS;
  const year = entry.releaseDate.slice(0, 4);
  const meta = [year, entry.lengthLabel].filter(Boolean).join(' · ');
  const trimmed = entry.synopsis.endsWith('…');
  const moreUrl = sourceUrl(entry.source, entry.sourceId);
  const ratingCheck = (v: string) => { const p = parseRating(v); return p.ok ? null : p.error; };

  const genres = entry.genres.split(',').map((g) => g.trim()).filter(Boolean);

  return (
    <div className="screen has-backdrop">
      <CoverBackdrop src={entry.coverUrl} className="backdrop--top" />
      <div className="detail-top"><BackButton to={`/list/${entry.category}`} useHistory /><ShareButton rec={recFromEntry(entry)} /></div>
      <div className="screen__body detail">
        <div className="detail__top">
          <CoverImage src={entry.coverUrl} alt={`${entry.title} cover`} square={cfg.square} width={132} className="cover--hero rise-in" />
          <div className="detail__facts">
            <h1 className="detail__title">{entry.title}</h1>
            {entry.creator && <span className="detail__fact detail__fact--main">{entry.creator}</span>}
            {meta && <span className="detail__fact">{meta}</span>}
            {entry.origin && <span className="detail__fact">{`${ORIGIN_LABEL[entry.category]}: ${entry.origin}`}</span>}
            {entry.category === 'youtube' && sourceUrl(entry.source, entry.sourceId) && (
              // Dan, 2026-11-17: a video links straight to YouTube.
              <a className="btn btn--primary detail__watch" href={sourceUrl(entry.source, entry.sourceId)!} target="_blank" rel="noopener noreferrer">
                Watch on YouTube
              </a>
            )}
            {genres.length > 0 && (
              <span className="detail__genres">
                <span className="sr-only">{entry.genres}</span>
                {genres.map((g, i) => <span key={`${g}-${i}`} className="genre-pill" aria-hidden="true">{g}</span>)}
              </span>
            )}
          </div>
        </div>

        <div className="tiles">
          {/* A Plan to watch title has no rating field (N8). */}
          {!planned && (
            <div className="tile tile--rating">
              <div className="tile__rate-row">
                <DetailField
                  className="tile__field" label="Rating" type="number" value={typedNow === null ? '' : String(typedNow)} placeholder="Unrated"
                  check={ratingCheck}
                  onSave={(v) => {
                    // The field holds the typed number; the same number again changes nothing.
                    const p = parseRating(v);
                    if (p.ok && p.value !== typedNow) void saveRating(p.value);
                  }}
                />
                <RatingBadge rating={entry.rating} size="lg">
                  {entry.rating !== null && <CountUp value={entry.rating} />}
                </RatingBadge>
              </div>
              {entry.rating !== null && typedNow !== null && entry.rating !== typedNow && (
                <p className="field-hint">You typed {formatRating(typedNow)}; a close call nudged it to {formatRating(entry.rating)}.</p>
              )}
            </div>
          )}
          {cfg.hasStatus && (
            <div className="tile">
              <label className="field-label" htmlFor={statusId}>Status</label>
              <select
                id={statusId} className="input" value={entry.status ?? ''}
                onChange={(e) => save({ status: (e.target.value || null) as Status | null })}
              >
                <option value="">No status</option>
                {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s, entry.category)}</option>)}
              </select>
            </div>
          )}
        </div>

        {showsProgress(entry) && (
          <div className="tile tile--progress" role="group" aria-label="Progress">
            <span className="field-label">Progress</span>
            <ProgressControl entry={entry} />
          </div>
        )}

        {entry.detailsState === 'needs_review' && <PickMatch entry={entry} />}

        {entry.synopsis && (
          <section className="detail__section" aria-label="Synopsis">
            <p className={`synopsis${trimmed && !moreUrl && !expanded ? ' is-clamped' : ''}`}>{entry.synopsis}</p>
            {trimmed && moreUrl && (
              // The synopsis was cut at the source's own limit: the full text lives on its page.
              <a className="link-btn" href={moreUrl} target="_blank" rel="noopener noreferrer">More</a>
            )}
            {trimmed && !moreUrl && (
              <button type="button" className="link-btn" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
                {expanded ? 'Less' : 'More'}
              </button>
            )}
          </section>
        )}

        {cfg.hasSeasons && seasonsEnabled(me.settings, entry.category) && <SeasonsEditor entry={entry} />}

        <section className="detail__section">
          <DetailField label="Notes" multiline value={entry.notes} maxLength={5000} placeholder="Anything you want to remember"
            onSave={(notes) => save({ notes })} />
        </section>

        {!entry.isPrivate && <EntrySocial entryId={entry.id} ownerId={me.id} title={entry.title} />}

        <section className="detail__section" aria-label="Privacy">
          <h2 className="detail__h">Privacy</h2>
          <PrivacySwitch id={`${uid}-private`} label="Private — only you see this title" note="Friends can't see it, its posts or its notes."
            checked={entry.isPrivate} onChange={(isPrivate) => save({ isPrivate })} />
          <PrivacySwitch id={`${uid}-notes`} label="Keep notes private" note="Friends see the title, not your notes."
            checked={entry.notesPrivate} onChange={(notesPrivate) => save({ notesPrivate })} />
        </section>

        <section className="detail__section" aria-label="Edit details">
          <h2 className="detail__h">Edit details</h2>
          <div className="detail__edit">
            <DetailField label={cfg.titleLabel} value={entry.title} maxLength={300}
              check={(v) => (v.trim() === '' ? 'A title is required.' : null)} onSave={(title) => save({ title })} />
            {cfg.creatorLabel && <DetailField label={cfg.creatorLabel} value={entry.creator} maxLength={300} onSave={(creator) => save({ creator })} />}
            {entry.category === 'songs' && <DetailField label="Album" value={entry.album} maxLength={300} onSave={(album) => save({ album })} />}
            <DetailField label="Genres" value={entry.genres} maxLength={300} onSave={(genres) => save({ genres })} />
            <DetailField label="Cover image link" value={entry.coverUrl} maxLength={2000} placeholder="https://"
              check={(v) => (v === '' || isHttpUrl(v.trim()) ? null : 'Enter a link that starts with http:// or https://')}
              onSave={(coverUrl) => save({ coverUrl: coverUrl.trim() })} />
            <DetailField label="Release date" value={entry.releaseDate} placeholder="YYYY or YYYY-MM-DD"
              check={(v) => (v === '' || DATE_RE.test(v) ? null : 'Use YYYY or YYYY-MM-DD.')} onSave={(releaseDate) => save({ releaseDate })} />
            {PROGRESS_CATEGORIES.includes(entry.category) && (
              <DetailField label={entry.category === 'manga' ? 'Total chapters' : 'Total episodes'} type="number" placeholder="Unknown"
                value={entry.progressTotal == null ? '' : String(entry.progressTotal)}
                check={(v) => (v === '' || (/^\d+$/.test(v) && Number(v) <= PROGRESS_MAX) ? null : `Enter a whole number up to ${PROGRESS_MAX}, or leave it empty.`)}
                onSave={(v) => {
                  const progressTotal = v === '' ? null : Number(v);
                  // A count above a new total comes down to it.
                  const progress = progressTotal !== null && (entry.progress ?? 0) > progressTotal ? clampProgress(entry.progress ?? 0, progressTotal) : undefined;
                  save({ progressTotal, ...(progress !== undefined ? { progress } : {}) });
                }} />
            )}
            <DetailField label="Length" value={entry.lengthLabel} maxLength={300} onSave={(lengthLabel) => save({ lengthLabel })} />
            <DetailField label={ORIGIN_LABEL[entry.category]} value={entry.origin} maxLength={300} onSave={(origin) => save({ origin })} />
            <DetailField label="Synopsis" multiline value={entry.synopsis} maxLength={5000} onSave={(synopsis) => save({ synopsis })} />
          </div>
        </section>

        <div className="detail__actions">
          <Button onClick={() => setSheet('refetch')}>Re-fetch</Button>
          <Button className="btn--danger" onClick={() => setSheet('delete')}>Delete</Button>
        </div>
      </div>

      {closeCallSheet}
      {sheet === 'refetch' && <RefetchSheet entry={entry} onClose={() => setSheet(null)} />}
      {sheet === 'delete' && (
        <DeleteSheet
          entry={entry} onClose={() => setSheet(null)}
          onDeleted={() => {
            navigate(`/list/${entry.category}`);
            removeEntryFromCache(qc, entry);
            // The Worker re-fitted the titles left in its list: a close neighbour's nudge may have gone.
            void refetchAfterDelete(qc, { kind: 'entry', category: entry.category });
            toast.show(`Deleted ${entry.title}`);
          }}
        />
      )}
    </div>
  );
}

/** "Pick the right match": for an imported title the backfill wasn't sure about. Looks it up fresh and shows the picker. */
function PickMatch({ entry }: { entry: Entry }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [choices, setChoices] = useState<LookupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async (term: string): Promise<LookupInfo[]> => {
    const info = await runLookup(buildLookupQuery(entry.category, term, entry.creator));
    if (!info) return [];
    return closestFirst(term, info.choices?.length ? info.choices : [info]);
  };

  async function open() {
    if (busy) return;
    setBusy(true);
    const found = await find(entry.title);
    setBusy(false);
    if (found.length === 0) { toast.show("Couldn't find a match"); return; }
    setChoices(found);
  }

  async function choose(info: LookupInfo) {
    setChoices(null);
    setBusy(true);
    const ok = await applyLookupMatch(qc, entry, entry.title, info, { settle: true });
    setBusy(false);
    if (!ok) toast.show("Couldn't save that match");
  }

  return (
    <section className="detail__section" aria-label="Check the match">
      <p className="field-hint">We weren't sure the details we found belong to this title.</p>
      <Button variant="primary" disabled={busy} onClick={() => void open()}>Pick the right match</Button>
      {choices && (
        <PickerSheet
          category={entry.category} typed={entry.title} choices={choices}
          onChoose={(info) => void choose(info)}
          onKeepTyped={() => setChoices(null)}
          onSearch={async (term) => {
            const found = await find(term.trim());
            if (found.length === 0) return 'none';
            setChoices(found);
            return 'choices';
          }}
        />
      )}
    </section>
  );
}

function RefetchSheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const termId = useId();
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await refetchEntry(qc, entry, term);
      if (result === 'not_found') toast.show("Couldn't find a match");
      onClose();
    } catch {
      setBusy(false);
      toast.show("Couldn't re-fetch. Try again.");
    }
  }

  return (
    <Sheet open title="Re-fetch" onClose={onClose}
      footer={<Button type="submit" form="refetch-form" variant="primary" className="btn--block" disabled={busy}>{busy ? 'Looking…' : 'Look it up'}</Button>}>
      <form id="refetch-form" className="add-form" onSubmit={(e) => void go(e)}>
        <p className="field-hint">
          Looks this title up again and replaces its cover, genres, {cfg(entry)} and details. Your rating, status and notes stay as they are.
        </p>
        <div className="field">
          <label className="field-label" htmlFor={termId}>Search term (optional)</label>
          <input id={termId} className="input" value={term} maxLength={300} placeholder={entry.title} onChange={(e) => setTerm(e.target.value)} />
        </div>
      </form>
    </Sheet>
  );
}

const cfg = (e: Entry) => (CATEGORY_CONFIG[e.category].creatorLabel ?? 'creator').toLowerCase();

function DeleteSheet({ entry, onClose, onDeleted }: { entry: Entry; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await retryOnConflict(() => api.del(`/api/entries/${entry.id}`));
      onDeleted();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 404) { onDeleted(); return; }
      toast.show("Couldn't delete that. Try again.");
    }
  }

  return (
    <Sheet open title="Delete this entry?" onClose={onClose}
      footer={
        <div className="detail__actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button className="btn--danger" disabled={busy} onClick={() => void remove()}>Delete</Button>
        </div>
      }>
      <p>
        "{entry.title}" will be removed from your {LIST_LABEL[entry.category]} list{CATEGORY_CONFIG[entry.category].hasSeasons ? ', along with its seasons' : ''}. This can't be undone.
      </p>
    </Sheet>
  );
}
