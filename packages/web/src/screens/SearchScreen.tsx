import { CATEGORY_CONFIG, SEARCH_SCOPE, type Category, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAllEntries } from '../data/useEntries';
import { SETTINGS_SAVE_ERROR, useSaveSettings } from '../data/useMe';
import { Button } from '../design/components/Button';
import { CoverImage } from '../design/components/CoverImage';
import { EmptyState } from '../design/components/EmptyState';
import { SegRadio } from '../design/components/SegRadio';
import { Icon } from '../design/components/Icon';
import { RatingBadge } from '../design/components/RatingBadge';
import { SkeletonRow } from '../design/components/Skeleton';
import { searchEntries } from '../lists/search';
import { useUrlText } from '../lists/useUrlText';
import { enabledLists, LIST_LABEL } from '../nav';
import { useCurrentList } from '../shell/currentList';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import '../design/search.css';
import { searchable, useUserSearch } from '../data/social';
import { PeopleList } from './social/PeopleList';
import { useDebounced } from './social/parts';

/** Results per list before "Show N more". */
const GROUP_LIMIT = 50;

/** Global search (route /search): people (Add / view profile) plus titles, creators, albums and genres across the lists, or just the current one. */
export function SearchScreen() {
  const me = useSessionMe();
  const qc = useQueryClient();
  const save = useSaveSettings({ errorToast: SETTINGS_SAVE_ERROR });
  const { text, setText, clear } = useUrlText('q');
  const current = useCurrentList();
  const inputRef = useRef<HTMLInputElement>(null);
  // Typing stays instant; the folding and the up-to-350 rows follow when the device has a moment.
  const deferred = useDeferredValue(text);
  const [expanded, setExpanded] = useState<ReadonlySet<Category>>(new Set());

  const scope = current !== null && me.settings.searchScope === 'current' ? 'current' : 'all';
  const enabledKey = enabledLists(me.settings).join(',');
  // A stable array: the queries behind useAllEntries are keyed by it.
  const lists = useMemo<Category[]>(() => {
    const on = enabledKey ? (enabledKey.split(',') as Category[]) : [];
    return scope === 'current' && current ? [current] : on;
  }, [enabledKey, scope, current]);
  const { data, isPending, isError } = useAllEntries(lists);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setExpanded(new Set()); }, [deferred, scope]);

  const q = deferred.trim();
  const groups = useMemo(() => searchEntries(data, lists, deferred), [data, lists, deferred]);
  const loaded = lists.filter((c) => data[c]).length;
  const people = usePeople(q);

  const setScope = (v: (typeof SEARCH_SCOPE)[number]) => { if (me.settings.searchScope !== v) save.mutate({ searchScope: v }); };

  let body: ReactNode;
  // Spoken politely when the result changes; empty while there is nothing to say yet.
  let announce = '';
  if (!q) {
    body = <p className="search-hint">Search people, titles, creators, albums and genres.</p>;
  } else if (isError && loaded === 0) {
    body = (
      <EmptyState icon="info" title="Couldn't load your lists" body="Check your connection and try again."
        actionLabel="Retry" onAction={() => void qc.refetchQueries({ queryKey: ['entries'] })} />
    );
  } else if (isPending && groups.length === 0 && lists.some((c) => !data[c])) {
    body = <div aria-busy="true" className="stack-10"><SkeletonRow /><SkeletonRow /></div>;
  } else if (groups.length === 0 && people.length > 0) {
    announce = `${people.length} ${people.length === 1 ? 'person' : 'people'}`;
    body = null;
  } else if (groups.length === 0) {
    announce = 'No matches';
    body = (
      <EmptyState
        icon="search" title={`No matches for “${q}”.`}
        body={scope === 'current'
          ? `Nothing in ${current ? LIST_LABEL[current] : 'this list'} matches. Your other lists might.`
          : 'Check the spelling, or try fewer words.'}
        actionLabel={scope === 'current' ? 'Search all lists' : undefined}
        onAction={scope === 'current' ? () => setScope('all') : undefined}
      />
    );
  } else {
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    announce = `${total} ${total === 1 ? 'result' : 'results'}`;
    body = (
      <div className="search-screen__results">
        {isError && <div className="load-notice" role="status"><span>Couldn't load some lists.</span></div>}
        {groups.map(({ category, rows }) => {
          const all = expanded.has(category);
          const shown = all ? rows : rows.slice(0, GROUP_LIMIT);
          const hidden = rows.length - shown.length;
          const id = `search-${category}`;
          return (
            <section key={category} aria-labelledby={id} className="search-group">
              <h2 id={id} className="search-group__title">{`${LIST_LABEL[category]} · ${rows.length}`}</h2>
              <ul className="stack-10 plain-list">
                {shown.map((e) => <ResultRow key={e.id} entry={e} />)}
              </ul>
              {hidden > 0 && (
                <Button variant="secondary" className="search-group__more"
                  onClick={() => setExpanded(new Set([...expanded, category]))}>
                  Show {hidden} more
                </Button>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="screen">
      <PageHeader title="Search" profile>
        <div className="search-screen__controls">
          <div className="search">
            <label htmlFor="search-q" className="sr-only">Search people and your lists</label>
            <span className="search__icon" aria-hidden="true"><Icon name="search" size={20} /></span>
            <input
              id="search-q" ref={inputRef} type="search" className="search__input" autoComplete="off" spellCheck={false}
              placeholder="Search people and your lists" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && text) { e.preventDefault(); clear(); } }}
            />
            {text && (
              <button type="button" className="search__clear" aria-label="Clear search"
                onClick={() => { clear(); inputRef.current?.focus(); }}><Icon name="close" size={18} /></button>
            )}
          </div>
          {current && (
            <SegRadio label="Search in" value={scope}
              options={[{ value: 'all', label: 'All lists' }, { value: 'current', label: LIST_LABEL[current] }]}
              onChange={setScope} />
          )}
        </div>
      </PageHeader>
      <div className="screen__body">
        <p role="status" aria-live="polite" className="sr-only">{announce}</p>
        {people.length > 0 && (
          <section aria-labelledby="search-people" className="search-group">
            <h2 id="search-people" className="search-group__title">{`People · ${people.length}`}</h2>
            <PeopleList users={people} label="People" linkProfiles />
          </section>
        )}
        {body}
      </div>
    </div>
  );
}

function ResultRow({ entry: e }: { entry: Entry }) {
  const square = CATEGORY_CONFIG[e.category].square;
  const meta = [e.creator, e.genres].filter(Boolean).join(' · ');
  return (
    <li className="entry-card entry-card--ok">
      <Link className="entry-card__link" to={`/entry/${e.id}`}>
        {/* Decorative: the row's name is its text. */}
        <span aria-hidden="true"><CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={square} /></span>
        <div className="entry-card__text">
          <span className="entry-card__title" data-role="title">{e.title}</span>
          {meta && <span className="entry-card__meta">{meta}</span>}
        </div>
        <RatingBadge rating={e.rating} />
      </Link>
    </li>
  );
}

/** People whose username starts with the search (2+ characters, "@" optional): Add, or tap to view their profile. */
function usePeople(q: string) {
  const query = useDebounced(q);
  const ok = query !== '' && searchable(query);
  const search = useUserSearch(query, ok);
  return ok ? search.data ?? [] : [];
}
