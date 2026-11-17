import { CATEGORY_CONFIG, formatRating, statusLabel, type Category, type FriendEntry, type PublicUser } from '@media-tracker/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { LIST_LABEL, LIST_ORDER } from '../../nav';
import { computeStats } from '../../ratings/stats';
import { topFive } from '../../ratings/topFive';
import { useIsWide } from '../../hooks';
import { BackButton } from '../../shell/BackButton';
import { useSessionMe } from '../../shell/SessionGate';
import { ListCard } from '../StatsScreen';
import { TopRow } from '../Top5Screen';
import { CompareWithFriend } from './CompareWithFriend';
import { CategoryChips, PersonAvatar, Tabs, who, type TabDef } from './parts';
import '../../design/ratings.css';
import '../../design/social.css';
import '../../design/plan.css';
import '../../design/lists.css';

const TABS: TabDef<'lists' | 'top5' | 'stats' | 'compare'>[] = [
  { id: 'lists', label: 'Lists' }, { id: 'top5', label: 'Top 5' }, { id: 'stats', label: 'Stats' }, { id: 'compare', label: 'Compare' },
];
type TabId = (typeof TABS)[number]['id'];
const DASH = '—';

/** "Nov 2026" from an ISO timestamp (SQLite's "YYYY-MM-DD HH:MM:SS" counts as UTC). */
function monthYear(at: string): string | null {
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
        <div className="friend-top"><BackButton to="/friends" /></div>
        <div className="screen__body stack-10"><Skeleton height={96} /><Skeleton height={64} /><Skeleton height={64} /></div>
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    const missing = (profile.error as { status?: number } | null)?.status === 404;
    return (
      <div className="screen">
        <div className="friend-top"><BackButton to="/friends" /></div>
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
      <div className="friend-top"><BackButton to="/friends" /></div>
      <div className="screen__body social-page">
        <div className="friend-id">
          <PersonAvatar user={user} size={80} />
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
  const categories = useMemo(() => LIST_ORDER.filter((c) => rows?.some((e) => e.category === c)), [rows]);
  const asked = params.get('c');
  const category: Category | null = categories.find((c) => c === asked) ?? categories[0] ?? null;
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
        <BackButton to="/friends" />
        <MoreMenu user={user} friends={friends.data} />
      </div>
      <div className="screen__body social-page friend-page">
        <div className="friend-id">
          <PersonAvatar user={user} size={80} />
          <h1>{who(user)}</h1>
          {user.displayName && <span className="friend-id__user">@{user.username}</span>}
          {bio && <p className="friend-id__bio">{bio}</p>}
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
                <CategoryChips categories={categories} value={category} onChange={setCategory} />
              )}
              {tab === 'lists' && category && <ListsPanel username={user.username} rows={rows.filter((e) => e.category === category)} />}
              {tab === 'top5' && <Top5Panel username={user.username} rows={rows} categories={categories} />}
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

function ListsPanel({ username, rows }: { username: string; rows: FriendEntry[] }) {
  const sorted = useMemo(() => sortEntries(rows, 'rating'), [rows]);
  const wide = useIsWide();
  // PC: the same rows as your own list table (Dan, 2026-11-17), read-only.
  if (wide && sorted[0]) return <FriendTable username={username} rows={sorted} />;
  return (
    <ul className="people plain-list">
      {sorted.map((e) => {
        const cfg = CATEGORY_CONFIG[e.category];
        const status = e.status && cfg.hasStatus ? statusLabel(e.status, e.category) : null;
        const label = [e.title, status, e.rating !== null ? `rated ${formatRating(e.rating)}` : 'not rated'].filter(Boolean).join(', ');
        return (
          <li key={e.id}>
            <Link to={entryLink(username, e.id)} className="person" aria-label={label}>
              <span aria-hidden="true"><CoverImage src={e.coverUrl} alt="" square={cfg.square} width={40} /></span>
              <span className="person__meta">
                <span className="person__name">{e.title}</span>
                {e.status && cfg.hasStatus && <StatusPill status={e.status} category={e.category} />}
              </span>
              <RatingBadge rating={e.rating} size="sm" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function FriendTable({ username, rows }: { username: string; rows: FriendEntry[] }) {
  const cfg = CATEGORY_CONFIG[rows[0]!.category];
  return (
    <div className="table-wrap">
      <table className="entry-table" aria-label={`${LIST_LABEL[rows[0]!.category]}, @${username}`}>
        <thead>
          <tr>
            <th scope="col" className="col-cover">Cover</th>
            <th scope="col" className="col-rating">Rating</th>
            <th scope="col">Title</th>
            {cfg.hasStatus && <th scope="col">Status</th>}
            <th scope="col">Genres</th>
            {cfg.creatorLabel && <th scope="col">{cfg.creatorLabel}</th>}
            {cfg.hasSeasons && <th scope="col">Season Avg</th>}
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td><CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={cfg.square} width={40} className="cover--sm" /></td>
              <td><RatingBadge rating={e.rating} size="sm" /></td>
              <td><div className="cell-title"><Link to={entryLink(username, e.id)} data-role="title">{e.title}</Link></div></td>
              {cfg.hasStatus && <td>{e.status && <StatusPill status={e.status} category={e.category} />}</td>}
              <td className="muted">{e.genres}</td>
              {cfg.creatorLabel && <td>{e.creator}</td>}
              {cfg.hasSeasons && <td className="muted">{e.seasonAvg === null ? '' : formatRating(e.seasonAvg)}</td>}
              <td><span className="cell-notes" title={e.notes || undefined}>{e.notes ?? ''}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Top5Panel({ username, rows, categories }: { username: string; rows: FriendEntry[]; categories: Category[] }) {
  const blocks = categories.map((c) => ({ c, top: topFive(rows.filter((e) => e.category === c)) })).filter((b) => b.top.length > 0);
  if (blocks.length === 0) return <p className="friend-note">Nothing rated yet.</p>;
  return (
    <div className="top5">
      {blocks.map(({ c, top }) => (
        <section key={c} aria-labelledby={`ft5-${c}`} className="top5__block">
          <h2 id={`ft5-${c}`} className="top5__heading">{LIST_LABEL[c]}</h2>
          <ol className="top5__list">
            {top.map((e, i) => <TopRow key={e.id} entry={e} rank={i + 1} to={entryLink(username, e.id)} />)}
          </ol>
        </section>
      ))}
    </div>
  );
}

function StatsPanel({ rows, categories }: { rows: FriendEntry[]; categories: Category[] }) {
  const stats = computeStats(Object.fromEntries(categories.map((c) => [c, rows.filter((e) => e.category === c)])), categories);
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
      <section aria-labelledby="fstats-lists" className="stats__lists">
        <h2 id="fstats-lists" className="stats__heading">By list</h2>
        <ul className="stats__cards" aria-label="Stats by list">
          {stats.lists.map((l, i) => <ListCard key={l.category} name={LIST_LABEL[l.category]} s={l} index={i} tiers={null} />)}
        </ul>
      </section>
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
