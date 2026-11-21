import { formatRating, isBuiltinCategory, type Category, type FriendEntry, type PublicUser } from '@media-tracker/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TableFrame, useRowViewer, type ColumnDef, type ViewerItem } from '../list/tableKit';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  useAccept, useFriendEntries, useFriends, useProfile, useRemoveFriend, useSendRequest, type FriendsData,
} from '../../data/social';
import { Button } from '../../design/components/Button';
import { CoverImage } from '../../design/components/CoverImage';
import { EmptyState } from '../../design/components/EmptyState';
import { IconButton } from '../../design/components/IconButton';
import { RatingBadge } from '../../design/components/RatingBadge';
import { Sheet } from '../../design/components/Sheet';
import { Skeleton } from '../../design/components/Skeleton';
import { StatusPill } from '../../design/components/StatusPill';
import { useToast } from '../../design/components/Toast';
import { sortEntries } from '../../lists/sort';

import { computeStats, ratingDistribution } from '../../ratings/stats';
import { topFive } from '../../ratings/topFive';
import { useIsWide } from '../../hooks';
import { BackButton, backState } from '../../shell/BackButton';
import { useSessionMe } from '../../shell/SessionGate';
import { DistributionCard, GenresCard, ListCard } from '../StatsScreen';
import { TopRow } from '../Top5Screen';
import { CompareWithFriend } from './CompareWithFriend';
import { MessageButton } from '../messages/MessageButton';
import { CategoryChips, PersonAvatar, Tabs, who, type TabDef } from './parts';
import '../../design/ratings.css';
import '../../design/social.css';
import '../../design/plan.css';
import '../../design/lists.css';
import { listCfg, listLabel, presentLists, statusText } from '../../lists/registry';

const TABS: TabDef<'lists' | 'top5' | 'stats' | 'compare'>[] = [
  { id: 'lists', label: 'Lists' }, { id: 'top5', label: 'Top 5' }, { id: 'stats', label: 'Stats' }, { id: 'compare', label: 'Compare' },
];
type TabId = (typeof TABS)[number]['id'];
const DASH = '—';

/** "Nov 2026" from an ISO timestamp (SQLite's "YYYY-MM-DD HH:MM:SS" counts as UTC). */
export function monthYear(at: string): string | null {
  const iso = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(at) ? at : `${at.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A friend's profile (route /u/:username, S10): tabs for a friend, just the header and a button for anyone else. */
export function FriendProfile() {
  const { username = '' } = useParams();
  const me = useSessionMe();
  const profile = useProfile(username);
  if (username.toLowerCase() === me.username) return <Navigate to="/profile" replace />;
  if (profile.isPending) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        <div className="friend-top"><BackButton to="/friends" pc useHistory /></div>
        <div className="screen__body stack-10"><Skeleton height={96} /><Skeleton height={64} /><Skeleton height={64} /></div>
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    const missing = (profile.error as { status?: number } | null)?.status === 404;
    return (
      <div className="screen">
        <div className="friend-top"><BackButton to="/friends" pc useHistory /></div>
        <div className="screen__body">
          {missing ? (
            <EmptyState icon="info" title="We couldn't find that person" body="Check the username, or ask them for their invite link."
              actionLabel="Go to Friends" actionHref="/friends" />
          ) : (
            <EmptyState icon="info" title="Couldn't load this profile" body="Check your connection and try again."
              actionLabel="Retry" onAction={() => void profile.refetch()} />
          )}
        </div>
      </div>
    );
  }
  const { user, relation } = profile.data;
  return relation === 'friend' || relation === 'self'
    ? <FriendView user={user} bio={profile.data.bio ?? null} />
    : <StrangerView user={user} relation={relation} />;
}

/** Not a friend (yet): the header and one way forward. */
function StrangerView({ user, relation }: { user: PublicUser; relation: 'none' | 'pending_out' | 'pending_in' | 'self' | 'friend' }) {
  const toast = useToast();
  const send = useSendRequest();
  const accept = useAccept();
  const remove = useRemoveFriend();
  const guard = async (fn: () => Promise<unknown>, failed: string) => {
    try { await fn(); } catch { toast.show(failed); }
  };
  return (
    <div className="screen">
      <div className="friend-top"><BackButton to="/friends" pc useHistory /></div>
      <div className="screen__body social-page">
        <div className="friend-id">
          <PersonAvatar user={user} size={96} viewable name={who(user)} />
          <h1>{who(user)}</h1>
          {user.displayName && <span className="friend-id__user">@{user.username}</span>}
        </div>
        <p className="hint" style={{ textAlign: 'center' }}>Not friends yet</p>
        <div className="btn-row">
          {relation === 'pending_out' ? (
            <>
              <span className="person__sub" style={{ alignSelf: 'center', flex: 1, textAlign: 'center' }}>Requested</span>
              <Button disabled={remove.isPending} aria-label={`Cancel request to @${user.username}`}
                onClick={() => void guard(() => remove.mutateAsync(user.id), "Couldn't cancel. Try again.")}>Cancel</Button>
            </>
          ) : relation === 'pending_in' ? (
            <>
              <Button variant="primary" disabled={accept.isPending}
                onClick={() => void guard(async () => { await accept.mutateAsync(user.id); toast.show(`You and @${user.username} are friends`); }, "Couldn't accept. Try again.")}>Accept</Button>
              <Button disabled={remove.isPending} onClick={() => void guard(() => remove.mutateAsync(user.id), "Couldn't decline. Try again.")}>Decline</Button>
            </>
          ) : (
            <Button variant="primary" disabled={send.isPending}
              onClick={() => void guard(() => send.mutateAsync(user.username), "Couldn't send the request. Try again.")}>Add friend</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendView({ user, bio }: { user: PublicUser; bio: string | null }) {
  const [params, setParams] = useSearchParams();
  const entries = useFriendEntries(user.username);
  const friends = useFriends();
  const tab: TabId = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'lists';
  const rows = entries.data;
  // Their lists with something visible: built-in first, then their custom lists (Dan, 2026-11-19 Q2: same rules as built-in).
  const categories = useMemo(() => presentLists((rows ?? []).map((e) => e.category)), [rows]);
  // Compare needs the same list on both sides: built-in lists only (a custom list is its owner's own).
  const compareCategories = useMemo(() => categories.filter((c) => isBuiltinCategory(c)), [categories]);
  const asked = params.get('c');
  const shownCategories = tab === 'compare' ? compareCategories : categories;
  const category: Category | null = shownCategories.find((c) => c === asked) ?? shownCategories[0] ?? null;
  const setTab = (t: TabId) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const setCategory = (c: Category) => setParams((p) => { const n = new URLSearchParams(p); n.set('c', c); return n; }, { replace: true });

  const rated = rows?.filter((e) => e.rating !== null) ?? [];
  const average = rated.length ? rated.reduce((n, e) => n + (e.rating ?? 0), 0) / rated.length : null;
  const since = friends.data?.friends.find((f) => f.id === user.id)?.since;
  const tiles: [string, string | number][] = [
    ['Titles', rows ? rows.length : DASH],
    ['Rated', rows ? rated.length : DASH],
    ['Avg', rows ? (average === null ? DASH : formatRating(Math.round(average * 10) / 10)) : DASH],
    ['Friends since', (since && monthYear(since)) || DASH],
  ];

  return (
    <div className="screen">
      <div className="friend-top">
        <BackButton to="/friends" pc useHistory />
        <MoreMenu user={user} friends={friends.data} />
      </div>
      <div className="screen__body social-page friend-page">
        <div className="friend-id">
          <PersonAvatar user={user} size={96} viewable name={who(user)} />
          <h1>{who(user)}</h1>
          {user.displayName && <span className="friend-id__user">@{user.username}</span>}
          {bio && <p className="friend-id__bio">{bio}</p>}
          <MessageButton user={user} />
        </div>
        <dl className="friend-tiles">
          {tiles.map(([label, value]) => (
            <div key={label} className="friend-tile"><div><dt>{label}</dt><dd>{value}</dd></div></div>
          ))}
        </dl>
        <Tabs label="Friend profile" tabs={TABS} value={tab} onChange={setTab} idPrefix="friend" />
        <div role="tabpanel" id="friend-panel" aria-labelledby={`friend-tab-${tab}`} className="friend-panel">
          {entries.isPending ? (
            <div className="stack-10" aria-busy="true" aria-label="Loading"><Skeleton height={64} /><Skeleton height={64} /></div>
          ) : entries.isError || !rows ? (
            <EmptyState icon="info" title="Couldn't load their lists" body="Check your connection and try again."
              actionLabel="Retry" onAction={() => void entries.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState icon="info" title={`${who(user)} hasn't shared anything yet`} body="Their titles show here once they add some." />
          ) : (
            <>
              {(tab === 'lists' || tab === 'compare') && (
                <CategoryChips categories={shownCategories} value={category} onChange={setCategory} />
              )}
              {tab === 'lists' && category && <ListsPanel username={user.username} rows={rows.filter((e) => e.category === category)} name={who(user)} />}
              {tab === 'top5' && <Top5Panel username={user.username} rows={rows} categories={categories} name={who(user)} />}
              {tab === 'stats' && <StatsPanel rows={rows} categories={categories} />}
              {tab === 'compare' && category && <CompareWithFriend user={user} category={category} entries={rows} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const entryLink = (username: string, id: string) => `/u/${username}/entry/${id}`;

/** Where a row opens: a function of the entry id, or null for no link (the public page, item 34, has no entry page). */
export type EntryHref = ((id: string) => string) | null;
const hrefFor = (username: string, linkTo: EntryHref | undefined): EntryHref => (linkTo === undefined ? (id) => entryLink(username, id) : linkTo);

export function ListsPanel({ username, rows, linkTo, name }: { username: string; rows: FriendEntry[]; linkTo?: EntryHref; name?: string }) {
  const sorted = useMemo(() => sortEntries(rows, 'rating'), [rows]);
  const wide = useIsWide();
  const href = hrefFor(username, linkTo);
  // PC: the same rows as your own list table (Dan, 2026-11-17), read-only.
  if (wide && sorted[0]) return <FriendTable username={username} rows={sorted} linkTo={href} name={name} />;
  return (
    <ul className="people plain-list">
      {sorted.map((e) => {
        const cfg = listCfg(e.category);
        const status = e.status && cfg.hasStatus ? statusText(e.status, e.category) : null;
        const label = [e.title, status, e.rating !== null ? `rated ${formatRating(e.rating)}` : 'not rated'].filter(Boolean).join(', ');
        const inner = (
          <>
            {(!cfg.custom || cfg.lookup !== null) && <span aria-hidden="true"><CoverImage src={e.coverUrl} alt="" square={cfg.square} width={40} /></span>}
            <span className="person__meta">
              <span className="person__name">{e.title}</span>
              {e.status && cfg.hasStatus && <StatusPill status={e.status} category={e.category} />}
            </span>
            <RatingBadge rating={e.rating} size="sm" />
          </>
        );
        return (
          <li key={e.id}>
            {href
              ? <Link to={href(e.id)} state={backState(`${name ?? `@${username}`}'s lists`)} className="person" aria-label={label}>{inner}</Link>
              : <div className="person" aria-label={label} role="group">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function FriendTable({ username, rows, linkTo, name }: { username: string; rows: FriendEntry[]; linkTo?: EntryHref; name?: string }) {
  const href = hrefFor(username, linkTo);
  const back = backState(`${name ?? `@${username}`}'s lists`);
  const items = useMemo<ViewerItem[]>(() => rows.map((e) => ({
    id: e.id, title: e.title, category: e.category, coverUrl: e.coverUrl, rating: e.rating, status: e.status, creator: e.creator,
    releaseDate: e.releaseDate, genres: e.genres, synopsis: e.synopsis, source: e.source, sourceId: e.sourceId, to: href ? href(e.id) : null, state: back,
  })), [rows, href, back.backLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewer = useRowViewer(items);
  const cfg = listCfg(rows[0]!.category);
  // A custom list shows the columns its owner made it with (like their own table).
  const cover = !cfg.custom || cfg.lookup !== null;
  const year = cfg.custom && cfg.showYear;
  const link = cfg.custom && cfg.showLink;
  const columns: ColumnDef[] = [];
  if (cover) columns.push({ id: 'cover', label: 'Cover' });
  columns.push({ id: 'rating', label: 'Rating' }, { id: 'title', label: cfg.custom ? cfg.titleLabel : 'Title' });
  if (cfg.hasStatus) columns.push({ id: 'status', label: 'Status' });
  if (cfg.showGenres) columns.push({ id: 'genres', label: 'Genres' });
  if (cfg.creatorLabel) columns.push({ id: 'creator', label: cfg.creatorLabel });
  if (year) columns.push({ id: 'year', label: 'Year' });
  if (link) columns.push({ id: 'link', label: 'Link' });
  if (cfg.hasSeasons) columns.push({ id: 'avg', label: 'Season Avg' });
  columns.push({ id: 'notes', label: 'Notes' });
  return (
    <TableFrame list={rows[0]!.category} label={`${listLabel(rows[0]!.category)}, @${username}`} columns={columns} viewer={viewer}>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} {...viewer.rowProps(e.id)}>
            {cover && <td><CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={cfg.square} width={40} className="cover--sm" /></td>}
            <td><RatingBadge rating={e.rating} size="sm" /></td>
            <td><div className="cell-title">{href ? <Link to={href(e.id)} state={back} data-role="title">{e.title}</Link> : <span data-role="title">{e.title}</span>}</div></td>
            {cfg.hasStatus && <td>{e.status && <StatusPill status={e.status} category={e.category} />}</td>}
            {cfg.showGenres && <td className="muted col-genres" title={e.genres || undefined}>{e.genres}</td>}
            {cfg.creatorLabel && <td className="col-creator" title={e.creator || undefined}>{e.creator}</td>}
            {year && <td className="muted col-year">{e.releaseDate.slice(0, 4)}</td>}
            {link && <td className="col-link">{e.link && <a href={e.link} target="_blank" rel="noopener noreferrer" aria-label={`Open the link for ${e.title} (opens in a new tab)`}>Open ↗</a>}</td>}
            {cfg.hasSeasons && <td className="muted col-avg">{e.seasonAvg === null ? '' : formatRating(e.seasonAvg)}</td>}
            <td><span className="cell-notes" title={e.notes || undefined}>{e.notes ?? ''}</span></td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

export function Top5Panel({ username, rows, categories, linkTo, name }: { username: string; rows: FriendEntry[]; categories: Category[]; linkTo?: EntryHref; name?: string }) {
  const href = hrefFor(username, linkTo);
  const blocks = categories.map((c) => ({ c, top: topFive(rows.filter((e) => e.category === c)) })).filter((b) => b.top.length > 0);
  if (blocks.length === 0) return <p className="friend-note">Nothing rated yet.</p>;
  return (
    <div className="top5">
      {blocks.map(({ c, top }) => (
        <section key={c} aria-labelledby={`ft5-${c}`} className="top5__block">
          <h2 id={`ft5-${c}`} className="top5__heading">{listLabel(c)}</h2>
          <ol className="top5__list">
            {top.map((e, i) => <TopRow key={e.id} entry={e} rank={i + 1} to={href ? href(e.id) : null} backLabel={`${name ?? `@${username}`}'s Top 5`} />)}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function StatsPanel({ rows, categories }: { rows: FriendEntry[]; categories: Category[] }) {
  const byCategory = Object.fromEntries(categories.map((c) => [c, rows.filter((e) => e.category === c)]));
  const stats = computeStats(byCategory, categories);
  const dist = ratingDistribution(byCategory, categories);
  const { all } = stats;
  return (
    <div className="stats">
      <section aria-labelledby="fstats-all" className="stats__card stats__all">
        <h2 id="fstats-all" className="stats__card-title">All media</h2>
        <dl className="stats__kv">
          <div className="stats__kv-avg"><dt>Average</dt><dd className="stats__big">{all.average === null ? DASH : formatRating(Math.round(all.average * 100) / 100)}</dd></div>
          <div><dt>Entries</dt><dd className="stats__num">{all.entries}</dd></div>
          <div><dt>Rated</dt><dd className="stats__num">{all.rated}</dd></div>
          <div><dt>Completed</dt><dd className="stats__num">{all.completed ?? DASH}</dd></div>
          <div className="stats__kv-hi"><dt>Highest</dt><dd>{all.highest === null ? DASH : <RatingBadge rating={all.highest} size="sm" />}</dd></div>
        </dl>
      </section>
      <DistributionCard dist={dist} rated={all.rated} idPrefix="fstats" />
      <section aria-labelledby="fstats-lists" className="stats__lists">
        <h2 id="fstats-lists" className="stats__heading">By list</h2>
        <ul className="stats__cards" aria-label="Stats by list">
          {stats.lists.map((l, i) => <ListCard key={l.category} name={listLabel(l.category)} s={l} index={i} />)}
        </ul>
      </section>
      <GenresCard genres={stats.animeGenres} idPrefix="fstats" />
    </div>
  );
}

/** "More actions" (…): Remove friend, behind a confirm. */
function MoreMenu({ user, friends }: { user: PublicUser; friends: FriendsData | undefined }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const remove = useRemoveFriend();
  const toast = useToast();
  const navigate = useNavigate();
  const isFriend = friends ? friends.friends.some((f) => f.id === user.id) : true;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  if (!isFriend) return null;
  async function doRemove() {
    try {
      await remove.mutateAsync(user.id);
      toast.show(`Removed ${who(user)}`);
      navigate('/friends', { replace: true });
    } catch {
      toast.show("Couldn't remove them. Try again.");
    }
  }
  return (
    <div className="friend-top__end" ref={wrap}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); wrap.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus(); } }}>
      <IconButton label="More actions" icon="more" look="plain" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)} />
      {open && (
        <div role="menu" aria-label="More actions" className="menu">
          <button type="button" role="menuitem" className="menu__item" onClick={() => { setOpen(false); setConfirm(true); }}>Remove friend</button>
        </div>
      )}
      <Sheet open={confirm} title={`Remove ${who(user)}?`} onClose={() => setConfirm(false)}
        footer={
          <div className="btn-row">
            <Button variant="primary" disabled={remove.isPending} onClick={() => void doRemove()}>Remove friend</Button>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        }>
        <p className="hint">You'll stop seeing each other's lists. You can add each other again later.</p>
      </Sheet>
    </div>
  );
}
