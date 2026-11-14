import { CATEGORY_CONFIG, type Category, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { SAVE_FAILED, saveEntryChange } from '../data/entryMutations';
import { useEntries } from '../data/useEntries';
import { Button } from '../design/components/Button';
import { CountUp } from '../design/components/CountUp';
import { EmptyState } from '../design/components/EmptyState';
import { Icon } from '../design/components/Icon';
import { Sheet } from '../design/components/Sheet';
import { Skeleton, SkeletonRow } from '../design/components/Skeleton';
import { useToast } from '../design/components/Toast';
import { useAddEntry } from '../hooks/useAddEntry';
import { useIsWide } from '../hooks';
import { genreOptions, isFiltering, matchesFilter, normalizeFilter, readFilter, writeFilter, type ListFilter } from '../lists/filter';
import { SORT_KEYS, SORT_LABEL, sortEntries, type SortKey } from '../lists/sort';
import { ADD_NOUN, isCategory, LIST_LABEL, seasonsEnabled } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { CompareBanner } from './CompareBanner';
import { EntryCards } from './list/EntryCards';
import { EntryTable } from './list/EntryTable';
import { FilterChips, SearchBox, SearchToggle, useSearchOpen } from './list/ListFilters';

// The sheets are only needed once someone taps Add / Retry / Paste image link.
const AddEntry = lazy(() => import('./AddEntry').then((m) => ({ default: m.AddEntry })));
const PickerSheet = lazy(() => import('./PickerSheet').then((m) => ({ default: m.PickerSheet })));
const PasteImageSheet = lazy(() => import('./PasteImageSheet').then((m) => ({ default: m.PasteImageSheet })));

const NOUN: Record<Category, string> = {
  anime: 'anime', movies: 'movies', tv: 'TV shows', albums: 'albums', songs: 'songs', games: 'games', books: 'books',
};

/** While a sheet's code loads: an empty sheet with skeleton lines, so the tap answers at once. */
function SheetFallback({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Sheet open title={title} onClose={onClose}>
      <div aria-busy="true" className="stack-10"><Skeleton height={48} /><Skeleton height={48} /><Skeleton height={120} /></div>
    </Sheet>
  );
}

export function ListScreen() {
  const { category } = useParams();
  if (!isCategory(category)) return <Navigate to="/" replace />;
  return <ListBody key={category} category={category} />;
}

function ListBody({ category }: { category: Category }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useSessionMe();
  const wide = useIsWide();
  const { data, isPending, isError } = useEntries(category);
  const add = useAddEntry(category);
  const [sort, setSort] = useState<SortKey>('rating');
  const [addOpen, setAddOpen] = useState(false);
  const [pasteFor, setPasteFor] = useState<Entry | null>(null);

  const [params, setParams] = useSearchParams();
  const urlFilter = useMemo(() => readFilter(params), [params]);
  const genres = useMemo(() => genreOptions(data ?? []), [data]);
  // Until the rows load nothing can be judged invalid, so the URL's values stand.
  const clean = useMemo(
    () => (data ? normalizeFilter(urlFilter, CATEGORY_CONFIG[category].hasStatus, genres) : urlFilter),
    [data, urlFilter, category, genres],
  );
  // The box keeps its own text (no dropped characters or caret jumps); the URL follows ~150 ms later, by `replace`.
  const [qText, setQText] = useState(urlFilter.q);
  const lastWritten = useRef(urlFilter.q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (urlFilter.q !== lastWritten.current) { lastWritten.current = urlFilter.q; setQText(urlFilter.q); } // Back / reload
  }, [urlFilter.q]);
  useEffect(() => {
    if (!data || (clean.status === urlFilter.status && clean.genre === urlFilter.genre)) return;
    setParams((prev) => writeFilter({ ...readFilter(prev), status: clean.status, genre: clean.genre }, prev), { replace: true });
  }, [data, clean, urlFilter.status, urlFilter.genre, setParams]);
  const filter: ListFilter = { ...clean, q: qText };
  const [searchOpen, setSearchOpen] = useSearchOpen(qText);
  const toggleWrap = useRef<HTMLSpanElement>(null);
  const writeQ = (q: string) => {
    lastWritten.current = q;
    setParams((prev) => writeFilter({ ...readFilter(prev), q }, prev), { replace: true });
  };
  const changeFilter = (next: Partial<ListFilter>) => {
    const { q, ...rest } = next;
    if (q !== undefined) {
      setQText(q);
      clearTimeout(timer.current);
      if (q === '') writeQ('');
      else timer.current = setTimeout(() => writeQ(q), 150);
    }
    if (Object.keys(rest).length) setParams((prev) => writeFilter({ ...readFilter(prev), ...rest }, prev), { replace: true });
  };
  const clearAll = () => {
    clearTimeout(timer.current);
    lastWritten.current = '';
    setQText('');
    setParams((prev) => writeFilter({ q: '', status: '', genre: '' }, prev), { replace: true });
  };
  const filtering = isFiltering(filter);
  const total = data?.length ?? 0;
  const rows = useMemo(
    () => sortEntries((data ?? []).filter((e) => matchesFilter(e, filter)), sort),
    [data, filter, sort],
  );
  const rated = rows.filter((e) => e.rating !== null);
  const average = rated.length ? rated.reduce((s, e) => s + (e.rating as number), 0) / rated.length : null;
  const sub = data
    ? (
      <>
        {filtering
          ? `${rows.length} of ${total} ${total === 1 ? 'title' : 'titles'}`
          : `${rows.length} ${rows.length === 1 ? 'title' : 'titles'} · ${rated.length} rated`}
        {wide && !filtering && average !== null && <> · average <strong className="page-sub__num"><CountUp value={average} /></strong></>}
      </>
    )
    : undefined;
  // v2 header backdrop: the highest-rated title that has a cover, whatever the chosen sort.
  const backdrop = useMemo(
    () => sortEntries(data ?? [], 'rating').find((e) => e.rating !== null && e.coverUrl)?.coverUrl ?? null,
    [data],
  );
  const label = `${LIST_LABEL[category]} list`;
  const showSeasonAvg = seasonsEnabled(me.settings, category) && CATEGORY_CONFIG[category].hasSeasons;
  const addLabel = `Add ${ADD_NOUN[category]}`;
  const addButton = (
    <Button variant="primary" className={wide ? 'btn--add' : 'fab'} aria-label={addLabel} onClick={() => setAddOpen(true)}>
      <Icon name="plus" size={20} />{wide ? addLabel : 'Add'}
    </Button>
  );

  function savePaste(url: string) {
    if (pasteFor) void saveEntryChange(qc, pasteFor, { coverUrl: url, lookupState: 'ok' }, () => toast.show(SAVE_FAILED));
  }

  const actions = { onRetry: (e: Entry) => void add.retry(e), onPaste: setPasteFor };
  let body: ReactNode;
  if (isPending && !data) {
    body = (
      <div aria-busy="true" aria-label={`Loading ${NOUN[category]}`} className="stack-10">
        <SkeletonRow /><SkeletonRow /><SkeletonRow />
      </div>
    );
  } else if (isError && !data) {
    body = <EmptyState icon="info" title="Couldn't load this list" body="Check your connection and try again." />;
  } else if (total > 0 && rows.length === 0) {
    body = (
      <EmptyState
        icon="search" title="No matches" body={`Nothing in ${LIST_LABEL[category]} matches your search.`}
        actionLabel="Clear search and filters" onAction={clearAll}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={category}
        title={`No ${NOUN[category]} yet`}
        body={`Tap Add to put your first ${ADD_NOUN[category]} here. You can also import your Google Sheet.`}
      />
    );
  } else {
    body = wide
      ? <EntryTable rows={rows} label={label} showSeasonAvg={showSeasonAvg} {...actions} />
      : <EntryCards rows={rows} label={label} {...actions} />;
  }

  return (
    <div className="screen">
      <PageHeader
        title={LIST_LABEL[category]} sub={sub} backdrop={backdrop}
        actions={wide
          ? <>{total > 0 && <SearchBox category={category} filter={filter} onChange={changeFilter} wide open onClose={() => {}} />}{addButton}</>
          : total > 0 ? <span ref={toggleWrap}><SearchToggle open={searchOpen} onClick={() => setSearchOpen(!searchOpen)} /></span> : undefined}
      >
        {total > 0 && !wide && (
          <SearchBox category={category} filter={filter} onChange={changeFilter} wide={false} open={searchOpen} onClose={() => { setSearchOpen(false); toggleWrap.current?.querySelector('button')?.focus(); }} />
        )}
        {total > 0 && (
          <FilterChips
            category={category} filter={filter} onChange={changeFilter} genres={genres}
            sort={total > 1 ? (
              <div className="sort">
                <label className="sort__label" htmlFor="list-sort">Sort</label>
                <select id="list-sort" className="select-chip" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORT_KEYS.map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
                </select>
              </div>
            ) : undefined}
          />
        )}
      </PageHeader>
      <div className="screen__body list"><CompareBanner />{body}</div>
      {!wide && addButton}

      {addOpen && (
        <Suspense fallback={<SheetFallback title={`Add to ${LIST_LABEL[category]}`} onClose={() => setAddOpen(false)} />}>
          <AddEntry category={category} onSubmit={(input) => void add.add(input)} onClose={() => setAddOpen(false)} />
        </Suspense>
      )}
      {add.state === 'choose' && add.pickTarget && (
        <Suspense fallback={<SheetFallback title="Which one did you mean?" onClose={() => void add.keepTyped()} />}>
          <PickerSheet
            category={category} typed={add.pickTarget.typed} choices={add.choices}
            onChoose={(info) => void add.choose(info)} onKeepTyped={() => void add.keepTyped()} onSearch={add.search}
          />
        </Suspense>
      )}
      {pasteFor && (
        <Suspense fallback={<SheetFallback title="Paste image link" onClose={() => setPasteFor(null)} />}>
          <PasteImageSheet title={pasteFor.title} onSave={savePaste} onClose={() => setPasteFor(null)} />
        </Suspense>
      )}
    </div>
  );
}
