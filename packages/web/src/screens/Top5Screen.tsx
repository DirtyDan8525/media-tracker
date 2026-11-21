import { type Category, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { numberOnes, topFive } from '../ratings/topFive';
import { useAllEntries } from '../data/useEntries';
import { Button } from '../design/components/Button';
import { SegRadio } from '../design/components/SegRadio';
import { CoverBackdrop } from '../design/components/CoverBackdrop';
import { CoverImage } from '../design/components/CoverImage';
import { EmptyState } from '../design/components/EmptyState';
import { Icon } from '../design/components/Icon';
import { RatingBadge } from '../design/components/RatingBadge';
import { Skeleton } from '../design/components/Skeleton';
import { useCfSet, useThemeColors } from '../design/ThemeContext';
import { useIsWide } from '../hooks';
import { useEnabledLists } from '../shell/useLists';
import { backState } from '../shell/BackButton';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import type { CardSpec } from '../share/shareImage';
import { GroupTop5 } from './social/GroupTop5';
import { ShareSheet, type ShareRequest } from './top5/ShareSheet';
import '../design/ratings.css';
import { listCfg, listLabel } from '../lists/registry';

/** A card row for `e` (rated: topFive only returns rated rows). */
function cardRow(e: Entry, rank: number, listLabel?: string): CardSpec['rows'][number] {
  return {
    rank, ...(listLabel ? { listLabel } : {}), title: e.title, creator: e.creator, rating: e.rating ?? 0,
    square: listCfg(e.category).square, coverUrl: e.coverUrl,
  };
}

const WHOSE = [{ value: 'mine', label: 'Mine' }, { value: 'friends', label: 'Friends' }] as const;

/** The five best-rated titles of every list that is turned on (route /top5), or the group's with "Friends". */
export function Top5Screen() {
  const [whose, setWhose] = useState<'mine' | 'friends'>('mine');
  const toggle = <SegRadio className="seg--auto" label="Whose Top 5" value={whose} options={WHOSE} onChange={setWhose} />;
  return whose === 'friends' ? <GroupTop5 toggle={toggle} /> : <MineTop5 toggle={toggle} />;
}

function MineTop5({ toggle }: { toggle: ReactNode }) {
  const me = useSessionMe();
  const qc = useQueryClient();
  const lists = useEnabledLists();
  const { data, isPending, isError } = useAllEntries(lists);
  const colors = useThemeColors();
  const cf = useCfSet();
  const [sharing, setSharing] = useState<ShareRequest | null>(null);

  const loaded = lists.filter((c) => data[c]).length;
  if (isError && loaded === 0) {
    return (
      <div className="screen">
        <PageHeader title="Top 5" backTo="/profile" backUsesHistory profile>{toggle}</PageHeader>
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
        <PageHeader title="Top 5" backTo="/profile" backUsesHistory profile>{toggle}</PageHeader>
        <div className="screen__body stack-10"><Skeleton height={144} /><Skeleton height={56} /><Skeleton height={56} /></div>
      </div>
    );
  }
  const ones = numberOnes(data, lists);
  const theme = { username: me.username ?? '', colors, cf };
  const shareOnes = () => setSharing({
    sheetTitle: 'Share your #1s', filename: 'my-number-ones.png', shareTitle: 'My #1s',
    card: { ...theme, kind: 'ones', heading: 'My #1s', rows: ones.map((e) => cardRow(e, 1, listLabel(e.category))) },
  });
  const shareList = (c: Category, top: Entry[]) => {
    const heading = `My ${listLabel(c)} Top 5`;
    setSharing({
      sheetTitle: `Share your ${listLabel(c)} Top 5`, filename: `top5-${c}.png`, shareTitle: heading,
      card: { ...theme, kind: 'top5', heading, rows: top.map((e, i) => cardRow(e, i + 1)) },
    });
  };
  return (
    <div className="screen">
      <PageHeader title="Top 5" backTo="/profile" backUsesHistory profile sub="Your highest rated in each list.">
        {toggle}
        {ones.length > 0 && (
          <div className="top5__share-ones">
            <Button onClick={shareOnes}><Icon name="share" size={18} />Share my #1s</Button>
          </div>
        )}
      </PageHeader>
      {sharing && <ShareSheet request={sharing} onClose={() => setSharing(null)} />}
      <div className="screen__body top5">
        {isError && (
          <div className="load-notice" role="status">
            <span>Couldn't load some lists.</span>
            <Button variant="secondary" onClick={() => void qc.refetchQueries({ queryKey: ['entries'], predicate: (q) => q.state.status === 'error' })}>Retry</Button>
          </div>
        )}
        {lists.length === 0 && (
          <EmptyState icon="info" title="No lists are turned on" body="Turn a list on in Settings to see its Top 5." />
        )}
        {lists.map((c) => <TopBlock key={c} category={c} rows={data[c]} onShare={shareList} />)}
      </div>
    </div>
  );
}

/** `rows` is undefined when the list could not be loaded. */
function TopBlock({ category, rows, onShare }: {
  category: Category;
  rows: Entry[] | undefined;
  onShare: (c: Category, top: Entry[]) => void;
}) {
  const name = listLabel(category);
  const top = useMemo(() => topFive(rows ?? []), [rows]);
  const id = `top5-${category}`;
  return (
    <section aria-labelledby={id} className="top5__block">
      <h2 id={id} className="top5__heading">{name}</h2>
      {!rows ? (
        <div className="top5__empty"><p>Couldn't load {name}.</p></div>
      ) : top.length === 0 ? (
        <div className="top5__empty">
          <p>Nothing rated yet.</p>
          <Link to={`/list/${category}`} className="btn btn--secondary top5__go">Go to {name}</Link>
        </div>
      ) : (
        <>
          <ol className="top5__list">
            {top.map((e, i) => <TopRow key={e.id} entry={e} rank={i + 1} />)}
          </ol>
          <div className="top5__share">
            <Button onClick={() => onShare(category, top)}><Icon name="share" size={18} />Share {name} Top 5</Button>
          </div>
        </>
      )}
    </section>
  );
}

type TopEntry = Pick<Entry, 'id' | 'category' | 'title' | 'creator' | 'coverUrl' | 'rating'>;

/** One ranked row; it links to your entry, or to `to` (a friend's entry); `to` null is a plain row (the public profile page has no entry page). */
export function TopRow({ entry, rank, to, backLabel = 'Top 5', sub, label }: {
  entry: TopEntry; rank: number; to?: string | null; backLabel?: string;
  /** Accessible name for the link, when the row text alone reads badly. */
  label?: string;
  /** Replaces the creator line (the group Top 5 shows how many rated it). */
  sub?: string;
}) {
  const wide = useIsWide();
  const square = listCfg(entry.category).square;
  const hero = rank === 1;
  return (
    <li className={hero ? 'top5__item top5__item--hero' : 'top5__item'} data-square={square || undefined}>
      <RowShell to={to === null ? null : to ?? `/entry/${entry.id}`} backLabel={backLabel} label={label} className={hero ? 'top5__hero' : 'top5__row'}>
        {hero && <CoverBackdrop src={entry.coverUrl} />}
        <span className="top5__rank">{rank}</span>{' '}
        {/* Decorative: the row's name is its text, so the cover stays out of the link's name. */}
        <span className="top5__cover-wrap" aria-hidden="true">
          <CoverImage src={entry.coverUrl} alt={`${entry.title} cover`} square={square} width={hero ? 96 : wide ? 56 : 32}
            className={hero ? 'top5__cover top5__cover--hero' : 'top5__cover'} />
        </span>
        <span className="top5__text">
          <span className={hero ? 'top5__title top5__title--hero' : 'top5__title'}>{entry.title}</span>{' '}
          {(sub ?? entry.creator) && <span className="top5__creator">{sub ?? entry.creator}</span>}
        </span>{' '}
        <RatingBadge rating={entry.rating} size={hero ? 'md' : 'sm'} />
      </RowShell>
    </li>
  );
}

function RowShell({ to, className, backLabel, label, children }: { to: string | null; className: string; backLabel: string; label?: string; children: ReactNode }) {
  return to === null ? <div className={className}>{children}</div> : <Link to={to} state={backState(backLabel)} className={className} aria-label={label}>{children}</Link>;
}
