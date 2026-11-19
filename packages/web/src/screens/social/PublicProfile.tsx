import { formatRating, type Category, type PublicUser } from '@media-tracker/shared';
import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useAuthState } from '../../api/auth';
import { useAppSettings } from '../../data/appSettings';
import { publicAvatarSrc, usePublicEntries, usePublicProfile } from '../../data/publicLink';
import { useAccept, useProfile, useSendRequest } from '../../data/social';
import { useMe } from '../../data/useMe';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { CfSetContext, ThemeColorsContext } from '../../design/ThemeContext';
import { applyTheme, cfFor, themeColors } from '../../design/theme';
import { LIST_ORDER } from '../../nav';
import { setTitleOverride } from '../../pageTitle';
import { ListsPanel, monthYear, StatsPanel, Top5Panel } from './FriendProfile';
import { CategoryChips, PersonAvatar, Tabs, who, type TabDef } from './parts';
import '../../design/ratings.css';
import '../../design/social.css';
import '../../design/plan.css';
import '../../design/lists.css';

const TABS: TabDef<'lists' | 'top5' | 'stats'>[] = [{ id: 'lists', label: 'Lists' }, { id: 'top5', label: 'Top 5' }, { id: 'stats', label: 'Stats' }];
type TabId = (typeof TABS)[number]['id'];
const DASH = '—';

/** Keeps search engines off /p pages while one is open (the link is secret; it should never be indexed). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

/**
 * /p/:token (item 34), outside the session gate: works signed out and signed in. A read-only copy of a
 * friend's profile (header, Lists, Top 5, Stats) loaded only through the link's own routes; no Compare,
 * Message or feed. Signed out: "Join"; signed in: "Add friend" (or a way to their full profile).
 */
export function PublicProfile() {
  const { token = '' } = useParams();
  const profile = usePublicProfile(token);
  const brand = useAppSettings().brand;
  const auth = useAuthState();
  const meQ = useMe();
  const me = auth === 'ok' && !meQ.isPlaceholderData && meQ.data?.status === 'active' && meQ.data.username ? meQ.data : null;
  // Still finding out whether this visitor is signed in: show neither Join nor Add friend yet.
  const meLoading = auth === 'ok' && (meQ.isPending || meQ.isPlaceholderData);
  useNoIndex();

  const name = profile.data ? who(profile.data.user) : null;
  useEffect(() => {
    setTitleOverride(name ? `${name} on ${brand.name}` : null);
    return () => setTitleOverride(null);
  }, [name, brand.name]);
  // A signed-in visitor sees their own theme, as in the app.
  useEffect(() => { if (me) applyTheme(me.settings, document.documentElement, brand.accent); }, [me, brand.accent]);

  let body;
  if (profile.isPending) {
    body = (
      <div className="screen__body stack-10" aria-busy="true" aria-label="Loading"><Skeleton height={96} /><Skeleton height={64} /><Skeleton height={64} /></div>
    );
  } else if (profile.isError || !profile.data) {
    const missing = (profile.error as { status?: number } | null)?.status === 404;
    body = (
      <div className="screen__body">
        {missing ? (
          <EmptyState icon="info" title="This link doesn't work" body="It may have been turned off or replaced. Ask the person for a new one." />
        ) : (
          <EmptyState icon="info" title="Couldn't load this page" body="Check your connection and try again."
            actionLabel="Retry" onAction={() => void profile.refetch()} />
        )}
      </div>
    );
  } else {
    body = <PublicView token={token} user={profile.data.user} bio={profile.data.bio} memberSince={profile.data.memberSince} meId={me?.id ?? null} meLoading={meLoading} />;
  }
  const page = <div className="screen public-page">{body}</div>;
  return me ? (
    <ThemeColorsContext.Provider value={themeColors(me.settings)}>
      <CfSetContext.Provider value={cfFor(me.settings)}>{page}</CfSetContext.Provider>
    </ThemeColorsContext.Provider>
  ) : page;
}

function PublicView({ token, user, bio, memberSince, meId, meLoading }: {
  token: string; user: PublicUser; bio: string | null; memberSince: string | null; meId: string | null; meLoading: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const entries = usePublicEntries(token);
  const tab: TabId = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'lists';
  const rows = entries.data;
  const categories = useMemo(() => LIST_ORDER.filter((c) => rows?.some((e) => e.category === c)), [rows]);
  const asked = params.get('c');
  const category: Category | null = categories.find((c) => c === asked) ?? categories[0] ?? null;
  const setTab = (t: TabId) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const setCategory = (c: Category) => setParams((p) => { const n = new URLSearchParams(p); n.set('c', c); return n; }, { replace: true });

  const rated = rows?.filter((e) => e.rating !== null) ?? [];
  const average = rated.length ? rated.reduce((n, e) => n + (e.rating ?? 0), 0) / rated.length : null;
  const tiles: [string, string | number][] = [
    ['Titles', rows ? rows.length : DASH],
    ['Rated', rows ? rated.length : DASH],
    ['Avg', rows ? (average === null ? DASH : formatRating(Math.round(average * 10) / 10)) : DASH],
    ['Member since', (memberSince && monthYear(memberSince)) || DASH],
  ];

  return (
    <>
      <div className="screen__body social-page friend-page">
        <div className="friend-id">
          <PersonAvatar user={user} size={80} src={publicAvatarSrc(token)} />
          <h1>{who(user)}</h1>
          {user.displayName && <span className="friend-id__user">@{user.username}</span>}
          {bio && <p className="friend-id__bio">{bio}</p>}
        </div>
        <dl className="friend-tiles">
          {tiles.map(([label, value]) => (
            <div key={label} className="friend-tile"><div><dt>{label}</dt><dd>{value}</dd></div></div>
          ))}
        </dl>
        <Tabs label="Public profile" tabs={TABS} value={tab} onChange={setTab} idPrefix="public" />
        <div role="tabpanel" id="public-panel" aria-labelledby={`public-tab-${tab}`} className="friend-panel">
          {entries.isPending ? (
            <div className="stack-10" aria-busy="true" aria-label="Loading"><Skeleton height={64} /><Skeleton height={64} /></div>
          ) : entries.isError || !rows ? (
            <EmptyState icon="info" title="Couldn't load their lists" body="Check your connection and try again."
              actionLabel="Retry" onAction={() => void entries.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState icon="info" title={`${who(user)} hasn't shared anything yet`} body="Their titles show here once they add some." />
          ) : (
            <>
              {tab === 'lists' && <CategoryChips categories={categories} value={category} onChange={setCategory} />}
              {tab === 'lists' && category && <ListsPanel username={user.username} rows={rows.filter((e) => e.category === category)} linkTo={null} />}
              {tab === 'top5' && <Top5Panel username={user.username} rows={rows} categories={categories} linkTo={null} />}
              {tab === 'stats' && <StatsPanel rows={rows} categories={categories} />}
            </>
          )}
        </div>
      </div>
      {!meLoading && (
        <div className="public-cta">
          {meId ? <SignedInAction user={user} meId={meId} /> : <JoinAction user={user} />}
        </div>
      )}
    </>
  );
}

/** Signed out: Join (Create account), or, with sign-ups closed, who to ask. */
function JoinAction({ user }: { user: PublicUser }) {
  const app = useAppSettings();
  if (!app.features.signups) {
    return (
      <>
        <p className="public-cta__text">Ask {who(user)} for an invite link</p>
        <Link to="/" className="btn btn--ghost">Sign in</Link>
      </>
    );
  }
  return <Link to="/" className="btn btn--primary btn--block">Join {app.brand.name}</Link>;
}

/** Signed in: Add friend (the same request as the Add friend sheet), or where you already stand. */
function SignedInAction({ user, meId }: { user: PublicUser; meId: string }) {
  const app = useAppSettings();
  const self = user.id === meId;
  const profile = useProfile(user.username);
  const send = useSendRequest();
  const accept = useAccept();
  const toast = useToast();
  if (self) {
    return (
      <>
        <p className="public-cta__text">This is your public page.</p>
        <Link to="/profile" className="btn btn--secondary">Your profile</Link>
      </>
    );
  }
  const relation = profile.data?.relation;
  if (relation === 'friend') return <Link to={`/u/${user.username}`} className="btn btn--primary btn--block">Open full profile</Link>;
  if (!app.features.friends || !relation) return <Link to="/" className="btn btn--secondary btn--block">Open {app.brand.name}</Link>;
  if (relation === 'pending_out') return <p className="public-cta__text">Friend request sent</p>;
  if (relation === 'pending_in') {
    return (
      <Button variant="primary" className="btn--block" disabled={accept.isPending} aria-label={`Accept friend request from ${who(user)}`}
        onClick={() => accept.mutate(user.id, {
          onSuccess: () => toast.show(`You and ${who(user)} are friends`),
          onError: () => toast.show("Couldn't accept. Try again."),
        })}>Accept friend request</Button>
    );
  }
  return (
    <Button variant="primary" className="btn--block" disabled={send.isPending}
      onClick={() => send.mutate(user.username, {
        onSuccess: (r) => toast.show(r.relation === 'friend' ? `You and ${who(user)} are friends` : `Request sent to ${who(user)}`),
        onError: () => toast.show("Couldn't send the request. Try again."),
      })}>Add friend</Button>
  );
}
