import { formatRating, ratingColor, type Category } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties } from 'react';
import { useAllEntries } from '../data/useEntries';
import { Button } from '../design/components/Button';
import { CountUp } from '../design/components/CountUp';
import { EmptyState } from '../design/components/EmptyState';
import { RatingBadge } from '../design/components/RatingBadge';
import { Skeleton } from '../design/components/Skeleton';
import { useCfSet } from '../design/ThemeContext';
import { useIsWide } from '../hooks';
import { enabledLists, LIST_LABEL } from '../nav';
import { computeStats, ratingDistribution, type ListStats } from '../ratings/stats';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import '../design/ratings.css';

const DASH = '—';
const MAX_GENRES = 10;
const pct = (n: number, of: number): number => (of > 0 ? Math.round((n / of) * 100) : 0);

/** Counts and averages over the lists that are turned on (route /stats). Charts are drawn in theme colours; every one has a table beside it for screen readers. */
export function StatsScreen() {
  const me = useSessionMe();
  const qc = useQueryClient();
  const cf = useCfSet();
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  const { data, isPending, isError } = useAllEntries(lists);
  const wide = useIsWide();
  const [allGenres, setAllGenres] = useState(false);
  // Cheap sums over a few hundred rows; `data` is a fresh object each render, so a memo would never hit.
  const stats = computeStats(data, lists);
  const dist = ratingDistribution(data, lists);

  const loaded = lists.filter((c) => data[c]).length;
  if (isError && loaded === 0) {
    return (
      <div className="screen">
        <PageHeader title="Stats" backTo="/more" />
        <div className="screen__body">
          <EmptyState icon="info" title="Couldn't load your lists" body="Check your connection and try again."
            actionLabel="Retry" onAction={() => void qc.refetchQueries({ queryKey: ['entries'] })} />
        </div>
      </div>
    );
  }
  if (isPending && !isError && lists.some((c) => !data[c])) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        <PageHeader title="Stats" backTo="/more" />
        <div className="screen__body stack-10"><Skeleton height={140} /><Skeleton height={100} /><Skeleton height={160} /></div>
      </div>
    );
  }
  const { all } = stats;
  if (lists.length === 0 || all.entries === 0) {
    return (
      <div className="screen">
        <PageHeader title="Stats" backTo="/more" />
        <div className="screen__body">
          <EmptyState icon="info" title="Nothing to count yet"
            body={lists.length === 0 ? 'Turn a list on in Settings, then add some titles.' : 'Add some titles to a list and rate them to see your stats here.'} />
        </div>
      </div>
    );
  }
  const maxBin = Math.max(...dist, 1);
  const genres = allGenres ? stats.animeGenres : stats.animeGenres.slice(0, MAX_GENRES);
  const maxGenre = Math.max(...genres.map((g) => g.count), 1);

  return (
    <div className="screen">
      <PageHeader title="Stats" backTo="/more" sub="Your lists that are turned on. Completed shows “—” for lists without a Status." />
      <div className="screen__body stats">
        {isError && (
          <div className="load-notice" role="status">
            <span>Couldn't load some lists.</span>
            <Button variant="secondary" onClick={() => void qc.refetchQueries({ queryKey: ['entries'], predicate: (q) => q.state.status === 'error' })}>Retry</Button>
          </div>
        )}
        <section aria-labelledby="stats-all" className="stats__card stats__all">
          <h2 id="stats-all" className="stats__card-title">All media</h2>
          <div className="stats__all-body">
            <Ring rated={all.rated} entries={all.entries} />
            <dl className="stats__kv">
              <div className="stats__kv-avg">
                <dt>Average</dt>
                <dd className="stats__big">{all.average === null ? DASH : <CountUp value={all.average} />}</dd>
              </div>
              <div><dt>Entries</dt><dd className="stats__num">{all.entries}</dd></div>
              <div><dt>Completed</dt><dd className="stats__num">{all.completed ?? DASH}</dd></div>
              <div className="sr-only"><dt>Rated</dt><dd>{all.rated}</dd></div>
              <div className="stats__kv-hi">
                <dt>Highest</dt>
                <dd>{all.highest === null ? DASH : <RatingBadge rating={all.highest} size="sm" />}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section aria-labelledby="stats-dist" className="stats__card stats__dist">
          <h2 id="stats-dist" className="stats__card-title stats__card-title--plain">
            Rating distribution <span className="stats__note">{all.rated} rated</span>
          </h2>
          <div className="hist" aria-hidden="true">
            {dist.map((n, i) => (
              <div className="hist__col" key={i}>
                <span className="hist__bar bar-grow-y"
                  style={{ '--i': i, height: n === 0 ? 2 : `max(4px, calc((100% - 18px) * ${n / maxBin}))`, background: ratingColor(i + 1, cf) } as CSSProperties} />
                <span className="hist__x">{i + 1}</span>
              </div>
            ))}
          </div>
          <table className="sr-only">
            <caption>Ratings by score</caption>
            <thead><tr><th scope="col">Score</th><th scope="col">Ratings</th></tr></thead>
            <tbody>{dist.map((n, i) => <tr key={i}><th scope="row">{i + 1}</th><td>{n}</td></tr>)}</tbody>
          </table>
        </section>

        <section aria-labelledby="stats-lists" className="stats__lists">
          <h2 id="stats-lists" className="stats__heading">By list</h2>
          {wide ? (
            <div className="stats__table-wrap">
              <table className="stats__table">
                <caption className="sr-only">Stats by list</caption>
                <thead>
                  <tr>
                    <th scope="col">List</th><th scope="col" className="num">Entries</th><th scope="col" className="num">Rated</th>
                    <th scope="col" className="num">Average</th><th scope="col" className="num">Completed</th><th scope="col" className="num">Highest</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.lists.map((l, i) => <StatsRow key={l.category} name={LIST_LABEL[l.category as Category]} s={l} index={i} />)}
                  <StatsRow name="All media" s={all} index={stats.lists.length} total />
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="stats__cards" aria-label="Stats by list">
              {stats.lists.map((l, i) => <ListCard key={l.category} name={LIST_LABEL[l.category as Category]} s={l} index={i} />)}
            </ul>
          )}
        </section>

        {genres.length > 0 && (
          <section aria-labelledby="stats-genres" className="stats__genres">
            <h2 id="stats-genres" className="stats__heading">Anime by genre</h2>
            <div className="stats__table-wrap">
              <table className="stats__table stats__table--genres">
                <caption className="sr-only">Anime by genre</caption>
                <thead>
                  <tr><th scope="col">Genre</th><th scope="col" className="num">Titles</th><th scope="col" className="num">Average</th></tr>
                </thead>
                <tbody>
                  {genres.map((g, i) => (
                    <tr key={g.genre}>
                      <th scope="row">{g.genre}</th>
                      <td className="num"><Bar value={g.count / maxGenre} index={i} />{g.count}</td>
                      <td className="num">{g.average === null ? DASH : formatRating(g.average)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stats.animeGenres.length > MAX_GENRES && (
              <Button variant="secondary" className="stats__more" aria-expanded={allGenres} onClick={() => setAllGenres((v) => !v)}>
                {allGenres ? 'Show fewer genres' : `Show all ${stats.animeGenres.length} genres`}
              </Button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ListCard({ name, s, index }: { name: string; s: ListStats; index: number }) {
  return (
    <li className="stats__list-card">
      <div className="stats__list-head">
        <h3 className="stats__list-name">{name}</h3>
        {s.average !== null && <RatingBadge rating={s.average} size="xs" />}
      </div>
      <div className="stats__list-rated" aria-hidden="true">
        <Bar value={s.entries ? s.rated / s.entries : 0} index={index} />{s.rated}/{s.entries}
      </div>
      <dl className="stats__list-dl">
        <div><dt>Entries</dt><dd>{s.entries}</dd></div>
        <div><dt>Rated</dt><dd>{s.rated}</dd></div>
        <div><dt>Completed</dt><dd>{s.completed ?? DASH}</dd></div>
        <div><dt>Highest</dt><dd>{s.highest === null ? DASH : formatRating(s.highest)}</dd></div>
        {s.average === null && <div><dt>Average</dt><dd>{DASH}</dd></div>}
      </dl>
    </li>
  );
}

function StatsRow({ name, s, index, total }: { name: string; s: ListStats; index: number; total?: boolean }) {
  return (
    <tr className={total ? 'stats__total' : undefined}>
      <th scope="row">{name}</th>
      <td className="num">{s.entries}</td>
      <td className="num"><Bar value={s.entries ? s.rated / s.entries : 0} index={index} />{s.rated}</td>
      <td className="num">{s.average === null ? DASH : <RatingBadge rating={s.average} size="xs" />}</td>
      <td className="num">{s.completed ?? DASH}</td>
      <td className="num">{s.highest === null ? DASH : formatRating(s.highest)}</td>
    </tr>
  );
}

/** A decorative horizontal bar (0..1 of its track); the number beside it carries the meaning. */
function Bar({ value, index }: { value: number; index: number }) {
  return (
    <span className="gbar" aria-hidden="true">
      <span className="gbar__fill bar-grow-x" style={{ '--i': index, width: `${pct(value, 1)}%` } as CSSProperties} />
    </span>
  );
}

const R = 36;
const CIRC = 2 * Math.PI * R;

function Ring({ rated, entries }: { rated: number; entries: number }) {
  const frac = entries > 0 ? rated / entries : 0;
  return (
    <div className="ring" role="img" aria-label={`${rated} of ${entries} rated`}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle className="ring__track" cx="40" cy="40" r={R} />
        <circle className="ring__arc" cx="40" cy="40" r={R} strokeDasharray={`${CIRC * frac} ${CIRC}`}
          style={{ '--circ': CIRC, '--arc': CIRC * frac } as CSSProperties} />
      </svg>
      <span className="ring__label" aria-hidden="true"><span className="ring__n">{rated}</span><span className="ring__of">of {entries}</span></span>
    </div>
  );
}
