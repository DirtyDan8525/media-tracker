import { CATEGORY_CONFIG, type Category, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { SAVE_FAILED, saveEntryChange } from '../data/entryMutations';
import { useSavePlanOrder } from '../data/planOrder';
import { useEntries, useListCounts } from '../data/useEntries';
import { Button } from '../design/components/Button';
import { CountUp } from '../design/components/CountUp';
import { EmptyState } from '../design/components/EmptyState';
import { Icon } from '../design/components/Icon';
import { Sheet } from '../design/components/Sheet';
import { Skeleton, SkeletonRow } from '../design/components/Skeleton';
import { useToast } from '../design/components/Toast';
import { useAddEntry, type AddInput } from '../hooks/useAddEntry';
import { useIsWide } from '../hooks';
import { genreOptions, isFiltering, matchesFilter, normalizeFilter, readFilter, tagOptions, writeFilter, type ListFilter } from '../lists/filter';
import { planRows, readPlanView, writePlanView } from '../lists/plan';
import { useUrlText } from '../lists/useUrlText';
import { SORT_KEYS, SORT_LABEL, sortEntries, type SortKey } from '../lists/sort';
import { ADD_NOUN, isCategory, LIST_LABEL, seasonsEnabled } from '../nav';
import { rememberList } from '../shell/currentList';
import { ListMenu } from '../shell/ListMenu';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { useCloseCall } from './sharpen/CloseCallSheet';
import { useEnabledLists } from '../shell/useLists';
import { AnnouncementBanner } from './AnnouncementBanner';
import { InstallBanner } from './onboarding/InstallBanner';
import { EntryCards } from './list/EntryCards';
import { EntryTable } from './list/EntryTable';
import { PlanList } from './list/PlanList';
import { ActiveChips, activeFilters, FilterBar, FilterChips, FilterSheet, PlanSwitch, planLabel, SearchBox } from './list/ListFilters';
import { useDuplicateConfirm } from './list/DuplicateConfirm';

// The sheets are only needed once someone taps Add / Retry / Paste image link.
const AddEntry = lazy(() => import('./AddEntry').then((m) => ({ default: m.AddEntry })));
const PickerSheet = lazy(() => import('./PickerSheet').then((m) => ({ default: m.PickerSheet })));
const PasteImageSheet = lazy(() => import('./PasteImageSheet').then((m) => ({ default: m.PasteImageSheet })));

const NOUN: Record<Category, string> = {
  anime: 'anime', movies: 'movies', tv: 'TV shows', albums: 'albums', songs: 'songs', games: 'games', books: 'books', manga: 'manga', youtube: 'videos',
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
  const qc = useQueryClient();
  const toast = useToast();
  const me = useSessionMe();
  const lists = useEnabledLists();
  const wide = useIsWide();
  const { data, isPending, isError } = useEntries(category);
  const counts = useListCounts().data ?? {};
  const dup = useDuplicateConfirm();
  const add = useAddEntry(category, dup.confirm);
  useEffect(() => rememberList(category), [category]);
  const [sort, setSort] = useState<SortKey>('rating');
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Plan to watch (item 15): only lists with a Status column can have planned titles. Remembered per list on this device.
  const hasStatus = CATEGORY_CONFIG[category].hasStatus;
  const [plannedOn, setPlannedOn] = useState(() => hasStatus && readPlanView(category));
  const planned = hasStatus && plannedOn;
  const setPlanned = (on: boolean) => { setPlannedOn(on); writePlanView(category, on); };
  const savePlan = useSavePlanOrder(category, () => toast.show("Couldn't save the new order"));
  // A rated add: once the entry is saved and its lookup (and picker) is done, ask about close ratings (N6).
  const { ask: askClose, element: closeCallSheet } = useCloseCall();
  const [askFor, setAskFor] = useState<Entry | null>(null);
  useEffect(() => {
    if (askFor === null || (add.state !== 'idle' && add.state !== 'saved')) return;
    void askClose(askFor.category, askFor.id);
    setAskFor(null);
  }, [askFor, add.state, askClose]);
  const submitAdd = async (input: AddInput) => {
    const entry = await add.add(input);
    if (entry && input.category && input.category !== category) toast.show(`Added to ${LIST_LABEL[input.category]}`);
    if (entry && entry.rating !== null) setAskFor(entry);
  };
  const [pasteFor, setPasteFor] = useState<Entry | null>(null);

  const [params, setParams] = useSearchParams();
  // B3: the bottom bar's Add arrives as ?add=1: open the sheet, then drop `add` from the URL.
  const addRequested = params.get('add') === '1';
  useEffect(() => {
    if (!addRequested) return;
    setAddOpen(true);
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete('add');
      return p;
    }, { replace: true });
  }, [addRequested, setParams]);
  const urlFilter = useMemo(() => readFilter(params), [params]);
  const genres = useMemo(() => genreOptions(data ?? []), [data]);
  const tags = useMemo(() => tagOptions(data ?? []), [data]);
  // Until the rows load nothing can be judged invalid, so the URL's values stand.
  const clean = useMemo(
    () => (data ? normalizeFilter(urlFilter, CATEGORY_CONFIG[category].hasStatus, genres, tags) : urlFilter),
    [data, urlFilter, category, genres, tags],
  );
  // The box keeps its own text; the URL follows ~150 ms later, by `replace` (useUrlText).
  const { text: qText, setText: setQ, clear: clearQ } = useUrlText('q');
  useEffect(() => {
    if (!data || (clean.status === urlFilter.status && clean.genre === urlFilter.genre && clean.tag === urlFilter.tag)) return;
    setParams((prev) => writeFilter({ ...readFilter(prev), status: clean.status, genre: clean.genre, tag: clean.tag }, prev), { replace: true });
  }, [data, clean, urlFilter.status, urlFilter.genre, urlFilter.tag, setParams]);
  // The Plan to watch view is all one status, so a Status filter does not apply there (it comes back when the switch is off).
  const filter: ListFilter = { ...clean, status: planned ? '' : clean.status, q: qText };
  const changeFilter = (next: Partial<ListFilter>) => {
    const { q, ...rest } = next;
    if (q !== undefined) setQ(q);
    if (Object.keys(rest).length) setParams((prev) => writeFilter({ ...readFilter(prev), ...rest }, prev), { replace: true });
  };
  const clearAll = () => {
    clearQ();
    setParams((prev) => writeFilter({ q: '', status: '', genre: '', tag: '' }, prev), { replace: true });
  };
  const filtering = isFiltering(filter);
  const total = data?.length ?? 0;
  const plannedAll = useMemo(() => planRows(data ?? []), [data]);
  const planOrder = useMemo(() => plannedAll.map((e) => e.id), [plannedAll]);
  const rows = useMemo(
    () => (planned
      ? plannedAll.filter((e) => matchesFilter(e, filter))
      : sortEntries((data ?? []).filter((e) => matchesFilter(e, filter)), sort)),
    [data, plannedAll, planned, filter, sort],
  );
  const rated = rows.filter((e) => e.rating !== null);
  const average = rated.length ? rated.reduce((s, e) => s + (e.rating as number), 0) / rated.length : null;
  const chips = activeFilters(category, filter, planned);
  const removeChip = (key: 'status' | 'genre' | 'tag') => changeFilter(key === 'status' ? { status: '' } : key === 'tag' ? { tag: '' } : { genre: '' });
  const sub = !data
    ? undefined
    : planned
      ? (filtering ? `${rows.length} of ${plannedAll.length} planned` : `${rows.length} planned · your ${planLabel(category).split(' ').pop()} order`)
      : (
        <>
          {filtering
            ? `${rows.length} of ${total} ${total === 1 ? 'title' : 'titles'}`
            : `${rows.length} ${rows.length === 1 ? 'title' : 'titles'} · ${rated.length} rated`}
          {wide && !filtering && average !== null && <> · average <strong className="page-sub__num"><CountUp value={average} /></strong></>}
        </>
      );
  const label = `${LIST_LABEL[category]} list`;
  const showSeasonAvg = seasonsEnabled(me.settings, category) && CATEGORY_CONFIG[category].hasSeasons;
  const addLabel = `Add ${ADD_NOUN[category]}`;
  // PC only: on the phone, Add is the floating bubble.
  const addButton = (
    <Button variant="primary" className="btn--add" aria-label={addLabel} onClick={() => setAddOpen(true)}>
      <Icon name="plus" size={20} />{addLabel}
    </Button>
  );

  function savePaste(url: string) {
    if (pasteFor) void saveEntryChange(qc, pasteFor, { coverUrl: url, lookupState: 'ok' }, () => toast.show(SAVE_FAILED));
  }

  // The switch is on every list with a Status column; PC has it in the header's actions, the phone in its filter row.
  const planSwitch = hasStatus ? <PlanSwitch category={category} on={planned} onChange={setPlanned} /> : null;
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
  } else if (planned && plannedAll.length === 0) {
    body = (
      <EmptyState
        icon={category} title="Nothing planned yet"
        body={`Set a title's status to ${planLabel(category)} and it shows up here, in the order you choose.`}
      />
    );
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
  } else if (planned) {
    body = (
      <>
        {filtering && <p className="plan-hint">Clear the search and filters to change the order.</p>}
        <PlanList rows={rows} order={planOrder} label={label} reorderable={!filtering} onReorder={savePlan} {...actions} />
      </>
    );
  } else {
    body = wide
      ? <EntryTable rows={rows} label={label} showSeasonAvg={showSeasonAvg} {...actions} />
      : <EntryCards rows={rows} label={label} {...actions} />;
  }

  return (
    <div className="screen">
      <PageHeader
        title={LIST_LABEL[category]} sub={sub} icon={category} profile
        titleSlot={(
          <ListMenu lists={lists} value={category} counts={counts} menuLabel="Switch list" to={(c) => `/list/${c}`} heading>
            {LIST_LABEL[category]}
          </ListMenu>
        )}
        actions={wide ? <>{total > 0 && <SearchBox category={category} filter={filter} onChange={changeFilter} />}{planSwitch}{addButton}</> : undefined}
      >
        {total > 0 && !wide && (
          <>
            <FilterBar
              category={category} filter={filter} onChange={changeFilter} count={chips.length}
              onOpenFilters={() => setFiltersOpen(true)} planSwitch={planSwitch}
            />
            <ActiveChips chips={chips} onRemove={removeChip} />
          </>
        )}
        {total > 0 && wide && (
          <FilterChips
            category={category} filter={filter} onChange={changeFilter} genres={genres} tags={tags} planned={planned}
            sort={total > 1 && !planned ? (
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
      <div className="screen__body list"><AnnouncementBanner /><InstallBanner />{body}</div>

      {filtersOpen && (
        <FilterSheet
          category={category} filter={filter} onChange={changeFilter} genres={genres} tags={tags} sort={sort} onSort={setSort}
          planned={planned} shown={rows.length} onClose={() => setFiltersOpen(false)}
          onClear={() => { clearAll(); setSort('rating'); }}
        />
      )}
      {addOpen && (
        <Suspense fallback={<SheetFallback title="Add" onClose={() => setAddOpen(false)} />}>
          <AddEntry category={category} onSubmit={(input) => void submitAdd(input)} onClose={() => setAddOpen(false)} />
        </Suspense>
      )}
      {dup.element}
      {add.state === 'choose' && add.pickTarget && (
        <Suspense fallback={<SheetFallback title="Which one did you mean?" onClose={() => void add.keepTyped()} />}>
          <PickerSheet
            category={add.pickTarget.entry.category} typed={add.pickTarget.typed} choices={add.choices}
            onChoose={(info) => void add.choose(info)} onKeepTyped={() => void add.keepTyped()} onSearch={add.search}
          />
        </Suspense>
      )}
      {closeCallSheet}
      {pasteFor && (
        <Suspense fallback={<SheetFallback title="Paste image link" onClose={() => setPasteFor(null)} />}>
          <PasteImageSheet title={pasteFor.title} onSave={savePaste} onClose={() => setPasteFor(null)} />
        </Suspense>
      )}
    </div>
  );
}
