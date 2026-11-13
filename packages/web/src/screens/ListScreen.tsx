import { CATEGORY_CONFIG, type Category, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { saveEntryChange } from '../data/entryMutations';
import { useEntries } from '../data/useEntries';
import { Button } from '../design/components/Button';
import { EmptyState } from '../design/components/EmptyState';
import { Icon } from '../design/components/Icon';
import { Sheet } from '../design/components/Sheet';
import { Skeleton, SkeletonRow } from '../design/components/Skeleton';
import { useToast } from '../design/components/Toast';
import { useAddEntry } from '../hooks/useAddEntry';
import { useIsWide } from '../hooks';
import { SORT_KEYS, SORT_LABEL, sortEntries, type SortKey } from '../lists/sort';
import { ADD_NOUN, isCategory, LIST_LABEL, seasonsEnabled } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { EntryCards } from './list/EntryCards';
import { EntryTable, SAVE_FAILED } from './list/EntryTable';

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

  const rows = useMemo(() => sortEntries(data ?? [], sort), [data, sort]);
  const rated = rows.filter((e) => e.rating !== null);
  const average = rated.length ? rated.reduce((s, e) => s + (e.rating as number), 0) / rated.length : null;
  const sub = data
    ? `${rows.length} ${rows.length === 1 ? 'title' : 'titles'} · ${rated.length} rated${wide && average !== null ? ` · average ${average.toFixed(1)}` : ''}`
    : undefined;
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
      <PageHeader title={LIST_LABEL[category]} sub={sub} actions={wide ? addButton : undefined}>
        {rows.length > 1 && (
          <div className="sort">
            <label className="sort__label" htmlFor="list-sort">Sort</label>
            <select id="list-sort" className="select-chip" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORT_KEYS.map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </div>
        )}
      </PageHeader>
      <div className="screen__body list">{body}</div>
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
