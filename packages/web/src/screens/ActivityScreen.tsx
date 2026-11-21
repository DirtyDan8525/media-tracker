import { formatRating, nameOf, foldPosts, type ActivityLine, type Features, type PostSocial, type PublicUser, type Reaction, type Status } from '@media-tracker/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAppSettings } from '../data/appSettings';
import { useDeletePosts, useFeed, useMarkSeen, useReact, type SocialTarget } from '../data/feed';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';
import { Sheet } from '../design/components/Sheet';
import { useToast } from '../design/components/Toast';
import { CoverImage } from '../design/components/CoverImage';
import { EmptyState } from '../design/components/EmptyState';
import { SegRadio } from '../design/components/SegRadio';
import { SkeletonRow } from '../design/components/Skeleton';
import { Icon } from '../design/components/Icon';
import { TextSizeControl } from '../design/components/TextSizeControl';
import { useActivityTextSize } from '../design/components/useTextSize';
import { useIsWide, useNow } from '../hooks';
import { useCurrentList } from '../shell/currentList';
import { useAddFriend } from '../shell/AddFriendHost';
import { backState } from '../shell/BackButton';
import { PageHeader } from '../shell/PageHeader';
import { CommentsSheet } from './social/CommentsSheet';
import { ReactButton, ReactionChips } from './social/ReactionBar';
import { Avatar } from '../design/components/Avatar';
import { RatingBadge } from '../design/components/RatingBadge';
import { useSessionMe } from '../shell/SessionGate';
import { ActivityPanel, PostDetails } from './activity/ActivityDetails';
import { dayLabel, matchesSearch, timeAgo, type ActivityFilter } from './activity/format';
import '../design/activity.css';
import '../design/feed.css';
import '../design/list-menu.css';
import { listCfg, listLabel, listName, statusPhrase, statusText } from '../lists/registry';
import { LIST_ORDER } from '../nav';

const ALL_FILTERS: readonly { value: ActivityFilter; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'you', label: 'You' },
];

const isFilter = (v: string | null): v is ActivityFilter => ALL_FILTERS.some((f) => f.value === v);

const NO_SOCIAL: PostSocial = { reactions: {}, mine: [], comments: 0 };

/** A selection deletes at most this many posts at once (the server's limit). */
const MAX_SELECT = 100;

/**
 * Activity (route /activity, S6): Everyone (default; all active users, Dan 2026-11-16) / Friends / You;
 * each post carries reactions and comments. Your own posts have a ⋯ menu to delete them, and You has
 * a Select mode to delete several. A non-friend's name links to their profile; their title is plain
 * text (their entry page is friends-only).
 */
const MIN_CHOICES = [{ value: 7, label: 'Rated 7+' }, { value: 8, label: 'Rated 8+' }, { value: 9, label: 'Rated 9+' }] as const;

export function ActivityScreen() {
  const me = useSessionMe();
  const toast = useToast();
  const current = useCurrentList();
  const addFriend = useAddFriend();
  const { features } = useAppSettings();
  // AD2: with Friends switched off there is no Friends view.
  const FILTERS = features.friends ? ALL_FILTERS : ALL_FILTERS.filter((f) => f.value !== 'friends');
  const [params, setParams] = useSearchParams();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; batch: boolean; /** The admin deleting someone else's post. */ others?: boolean } | null>(null);
  const deletePosts = useDeletePosts();
  const shown = params.get('show');
  const filter: ActivityFilter = isFilter(shown) && FILTERS.some((f) => f.value === shown) ? shown : 'everyone';
  const setFilter = (v: ActivityFilter) => {
    setSelecting(false);
    setSelected(new Set());
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (v === 'everyone') p.delete('show');
      else p.set('show', v);
      return p;
    }, { replace: true });
  };

  // Discover filters (Dan, 2026-11-20): only one list (e.g. Songs) and/or only high ratings, kept in the URL.
  const appLists = useAppSettings().lists;
  const listChoices = LIST_ORDER.filter((c) => !appLists.hidden.includes(c));
  const listParam = params.get('list');
  const listFilter = listParam && (listChoices as readonly string[]).includes(listParam) ? listParam : null;
  const minParam = Number(params.get('min'));
  const minFilter = MIN_CHOICES.some((m) => m.value === minParam) ? minParam : null;
  const setParam = (key: 'list' | 'min', v: string | null) => setParams((prev) => {
    const p = new URLSearchParams(prev);
    if (v === null) p.delete(key); else p.set(key, v);
    return p;
  }, { replace: true });
  const { data, isPending, isError, isSuccess, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } =
    useFeed(filter, { list: listFilter, min: minFilter });
  const [commenting, setCommenting] = useState<SocialTarget | null>(null);
  const textSize = useActivityTextSize();
  const wide = useIsWide();
  // Phone: the post whose details sheet is open.
  const [opened, setOpened] = useState<string | null>(null);
  // PC details panel: the post hovered (after a short settle), focused or clicked last.
  const [active, setActive] = useState<string | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);
  const hoverPost = (key: string, on: boolean) => {
    clearTimeout(settle.current);
    if (on) settle.current = setTimeout(() => setActive(key), 120);
  };
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // S8: Everyone and Friends count as seen once they have loaded.
  const markSeen = useMarkSeen();
  const seenFor = useRef<string | null>(null);
  useEffect(() => {
    if (filter === 'you' || !isSuccess || seenFor.current === filter) return;
    seenFor.current = filter;
    markSeen.mutate();
  }, [filter, isSuccess, markSeen]);

  // S5: the server groups rows into posts; fold over every loaded page at once.
  const lines = useMemo(() => foldPosts(data?.pages.flatMap((p) => p.items) ?? []), [data]);
  const users = useMemo(() => Object.assign({}, ...(data?.pages.map((p) => p.users) ?? [])) as Record<string, PublicUser>, [data]);
  const friends = useMemo(() => new Set(data?.pages.flatMap((p) => p.friends ?? []) ?? []), [data]);
  const social = useMemo(() => Object.assign({}, ...(data?.pages.map((p) => p.social) ?? [])) as Record<string, PostSocial>, [data]);
  const needle = query.trim();
  const shownLines = useMemo(
    () => (needle === '' ? lines : lines.filter((l) => matchesSearch(needle, [
      l.title, l.creator, l.note,
      ...(l.userId === me.id ? ['You', me.username] : [users[l.userId]?.displayName, users[l.userId]?.username]),
    ]))),
    [lines, needle, users, me.id, me.username],
  );
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const doDelete = () => {
    if (!confirm) return;
    const { ids, batch } = confirm;
    deletePosts.mutate({ ids, batch }, {
      onSuccess: () => {
        setConfirm(null);
        setSelecting(false);
        setSelected(new Set());
        toast.show(ids.length === 1 ? 'Post deleted' : `${ids.length} posts deleted`);
      },
      onError: () => toast.show("Couldn't delete that. Try again."),
    });
  };
  // Ticks once a minute while the screen is visible, so "5 min ago" keeps up.
  const now = useNow();

  const detailProps = (key: string | null) => {
    const line = key ? shownLines.find((l) => l.key === key) : undefined;
    if (!line) return null;
    return {
      line, now, features, social: social[line.key] ?? NO_SOCIAL, friend: friends.has(line.userId),
      who: line.userId === me.id ? null : users[line.userId] ?? { id: line.userId, username: 'friend', displayName: 'A friend', avatarAt: null },
      onComment: () => { setOpened(null); setCommenting({ activityId: line.key, entryId: line.entryId }); },
    };
  };

  let body: ReactNode;
  if (isError && !data) {
    body = (
      <EmptyState icon="info" title="Couldn't load your activity" body="Check your connection and try again."
        actionLabel="Retry" onAction={() => void refetch()} />
    );
  } else if (isPending) {
    body = <div aria-busy="true" className="stack-10"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>;
  } else if (lines.length === 0 && !hasNextPage && (listFilter !== null || minFilter !== null)) {
    body = (
      <EmptyState icon="search" title="No posts match" body="Nobody has posted with these filters yet. Try another list or rating."
        actionLabel="Clear filters" onAction={() => setParams((prev) => { const p = new URLSearchParams(prev); p.delete('list'); p.delete('min'); return p; }, { replace: true })} />
    );
  } else if (lines.length === 0 && !hasNextPage && filter !== 'you') {
    body = (
      <EmptyState icon="activity" title="Nothing here yet" body={features.friends ? 'Add a friend to see what they rate.' : 'Rate something and it shows up here.'}
        actionLabel={features.friends ? 'Add friend' : undefined} onAction={features.friends ? addFriend : undefined} />
    );
  } else if (lines.length === 0 && !hasNextPage) {
    body = (
      <EmptyState icon="activity" title="Nothing here yet" body="Add or rate something and it shows up here."
        actionLabel={current ? `Open ${listLabel(current)}` : undefined}
        actionHref={current ? `/list/${current}` : undefined} />
    );
  } else {
    const days: { label: string; lines: ActivityLine[] }[] = [];
    for (const line of shownLines) {
      const label = dayLabel(line.at, now);
      const last = days[days.length - 1];
      if (last?.label === label) last.lines.push(line);
      else days.push({ label, lines: [line] });
    }
    body = (
      <div className="activity">
        {filter === 'you' && (
          <div className="activity__tools">
            {selecting ? (
              <>
                <Button onClick={() => { setSelecting(false); setSelected(new Set()); }}>Done</Button>
                <Button className="btn--danger" disabled={selected.size === 0}
                  onClick={() => setConfirm({ ids: [...selected], batch: true })}>
                  {selected.size === 1 ? 'Delete 1 post' : `Delete ${selected.size} posts`}
                </Button>
              </>
            ) : (
              <Button onClick={() => setSelecting(true)}>Select</Button>
            )}
          </div>
        )}
        {needle !== '' && shownLines.length === 0 && (
          <EmptyState icon="search" title="No matching posts" body={hasNextPage ? 'Nothing in the posts loaded so far. Show more to search further back.' : 'Try a different title, name or word from a note.'} />
        )}
        {days.map((d, i) => (
          // The id is an index: a day label ("Sat, 13 Nov") has spaces, which an IDREF can't hold.
          <section key={d.label} aria-labelledby={`activity-day-${i}`} className="activity__day">
            <h2 id={`activity-day-${i}`} className="activity__day-title">{d.label}</h2>
            <ul className="stack-10 plain-list">
              {d.lines.map((line) => (
                <FeedPost key={line.key} line={line} now={now} social={social[line.key] ?? NO_SOCIAL}
                  who={line.userId === me.id ? null : users[line.userId] ?? { id: line.userId, username: 'friend', displayName: 'A friend', avatarAt: null }}
                  friend={friends.has(line.userId)} features={features} admin={me.isAdmin} onComments={() => setCommenting({ activityId: line.key, entryId: line.entryId })}
                  onOpen={!wide && !selecting ? () => setOpened(line.key) : null}
                  panel={wide ? { active: active === line.key, show: () => { clearTimeout(settle.current); setActive(line.key); }, hover: (on) => hoverPost(line.key, on) } : null}
                  select={selecting && line.userId === me.id ? { on: selected.has(line.key), toggle: () => toggleSelected(line.key), full: selected.size >= MAX_SELECT } : null}
                  onDelete={() => setConfirm({ ids: [line.key], batch: false, others: line.userId !== me.id })} />
              ))}
            </ul>
          </section>
        ))}
        {isFetchNextPageError && (
          <div className="load-notice" role="status"><span>Couldn't load more.</span></div>
        )}
        {hasNextPage && (
          <Button variant="secondary" className="activity__more" disabled={isFetchingNextPage}
            aria-busy={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Show more
          </Button>
        )}
      </div>
    );
  }

  const filterCount = (listFilter !== null ? 1 : 0) + (minFilter !== null ? 1 : 0);
  const discoverControls = (
    <>
      <div className="activity-discover__lists" role="group" aria-label="Show posts from">
        <Button variant="chip" active={listFilter === null} onClick={() => setParam('list', null)}>All lists</Button>
        {listChoices.map((c) => (
          <Button key={c} variant="chip" active={listFilter === c} onClick={() => setParam('list', listFilter === c ? null : c)}>{listName(c)}</Button>
        ))}
      </div>
      <select aria-label="Rating" className={`select-chip${minFilter !== null ? ' is-on' : ''}`} value={minFilter ?? ''}
        onChange={(e) => setParam('min', e.target.value || null)}>
        <option value="">Any rating</option>
        {MIN_CHOICES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
    </>
  );

  return (
    <div className="screen activity-screen" style={{ '--activity-scale': textSize.scale } as CSSProperties}>
      <PageHeader title="Activity" profile>
        <div className="activity-show">
          <SegRadio block="activity-filter" label="Show" value={filter} options={FILTERS} onChange={setFilter} />
          {/* Phone: the list and rating filters live behind one button, so nothing gets cut off (Dan, 2026-11-20). */}
          {!wide && (
            <button type="button" className={`activity-filters-btn${filterCount > 0 ? ' is-on' : ''}`} aria-haspopup="dialog"
              onClick={() => setFiltersOpen(true)}>
              Filters{filterCount > 0 ? ` · ${filterCount}` : ''}
            </button>
          )}
        </div>
        <div className="activity-bar">
          <div className="search search--compact activity-bar__search">
            <label htmlFor="activity-q" className="sr-only">Search posts</label>
            <span className="search__icon" aria-hidden="true"><Icon name="search" size={20} /></span>
            <input id="activity-q" type="search" className="search__input" autoComplete="off" spellCheck={false}
              placeholder="Search posts" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }} />
            {query && (
              <button type="button" className="search__clear" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={18} /></button>
            )}
          </div>
          <TextSizeControl step={textSize.step} onChange={textSize.set} />
        </div>
        {wide && <div className="activity-discover">{discoverControls}</div>}
        {needle !== '' && hasNextPage && <p className="activity-bar__hint" role="status">Searching loaded posts</p>}
      </PageHeader>
      {!wide && (
        <Sheet open={filtersOpen} title="Filters" onClose={() => setFiltersOpen(false)}
          footer={<div className="activity-filters__foot">
            <Button onClick={() => setParams((prev) => { const p = new URLSearchParams(prev); p.delete('list'); p.delete('min'); return p; }, { replace: true })} disabled={filterCount === 0}>Clear</Button>
            <Button variant="primary" onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>}>
          <div className="activity-filters__sheet">
            {discoverControls}
          </div>
        </Sheet>
      )}
      <div className={wide ? 'screen__body activity-layout' : 'screen__body'}>
        <div className="activity-layout__feed">{body}</div>
        {wide && <ActivityPanel props={detailProps(active)} />}
      </div>
      {confirm && (
        <Sheet open title={confirm.batch ? (confirm.ids.length === 1 ? 'Delete 1 post?' : `Delete ${confirm.ids.length} posts?`) : 'Delete this post?'}
          onClose={() => { if (!deletePosts.isPending) setConfirm(null); }}
          footer={
            <div className="activity__confirm">
              <Button onClick={() => setConfirm(null)} disabled={deletePosts.isPending}>Cancel</Button>
              <Button className="btn--danger" disabled={deletePosts.isPending} onClick={doDelete}>
                {confirm.ids.length === 1 ? 'Delete post' : `Delete ${confirm.ids.length} posts`}
              </Button>
            </div>
          }>
          <p>{confirm.others ? 'You are deleting someone else\'s post. The title stays on their list.' : confirm.ids.length === 1 ? 'The title stays on your list.' : 'The titles stay on your list.'}</p>
        </Sheet>
      )}
      {!wide && opened && (() => {
        const p = detailProps(opened);
        return p && (
          <Sheet open title="Post details" onClose={() => setOpened(null)}>
            <PostDetails {...p} />
          </Sheet>
        );
      })()}
      {commenting && <CommentsSheet target={commenting} open onClose={() => setCommenting(null)} />}
    </div>
  );
}

/** One post (FeedV2.wf): avatar, the line with name and time, rating badge + reaction chips, the cover; React and Comment under it. `who` is null for your own. */
function FeedPost({ line, now, social, who, friend, features, admin, select, panel, onOpen, onComments, onDelete }: {
  line: ActivityLine; now: Date; social: PostSocial; who: PublicUser | null; friend: boolean;
  features: Features;
  /** The admin may delete anyone's post (AD7). */
  admin: boolean;
  /** Select mode on your own post: the checkbox state; null otherwise. */
  select: { on: boolean; toggle: () => void; full: boolean } | null;
  /** PC: the details panel hooks (hover with a settle delay, focus and click show it here); null on phones. */
  panel: { active: boolean; show: () => void; hover: (on: boolean) => void } | null;
  /** Phone: a tap on the post (not on one of its buttons or links) opens its details sheet; null while selecting and on PC. */
  onOpen: (() => void) | null;
  onComments: () => void; onDelete: () => void;
}) {
  const react = useReact();
  const target: SocialTarget = { activityId: line.key, entryId: line.entryId };
  const n = social.comments;
  const toggle = (emoji: Reaction) => react.mutate({ target, emoji });
  return (
    <li className={panel?.active ? 'feed-post feed-post--active' : 'feed-post'}
      {...(panel ? {
        onPointerEnter: (e: PointerEvent<HTMLLIElement>) => { if (e.pointerType === 'mouse') panel.hover(true); },
        onPointerLeave: () => panel.hover(false),
        onFocus: panel.show,
        onClick: panel.show,
      } : onOpen ? {
        onClick: (e: MouseEvent<HTMLLIElement>) => { if (!(e.target as Element).closest('a, button, input, label')) onOpen(); },
      } : {})}>
      <ActivityRow line={line} now={now} who={who} friend={friend}>
        {(line.rating || (features.reactions && Object.keys(social.reactions).length > 0)) && (
          <div className="feed-post__chips">
            {line.rating && <RatingBadge rating={line.rating.to} size="xs" />}
            {features.reactions && <ReactionChips social={social} onToggle={toggle} who={{ target, title: line.title }} />}
          </div>
        )}
      </ActivityRow>
      {line.note && <PostNote text={line.note} who={who === null ? 'You' : nameOf(who)} />}
      {select ? (
        <label className="feed-post__select">
          <input type="checkbox" aria-label={`Select ${line.title}`} checked={select.on} disabled={select.full && !select.on} onChange={select.toggle} />
          <span>Select this post</span>
        </label>
      ) : (
      <div className="feed-post__actions">
        {features.reactions && <ReactButton mine={social.mine} onPick={toggle} />}
        {features.comments && <Button variant="secondary" className="feed-post__comment" onClick={onComments}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16v11H9l-5 4z" />
          </svg>
          {n === 0 ? 'Comment' : `Comment (${n})`}
        </Button>}
        {(who === null || admin) && <PostMenu title={line.title} onDelete={onDelete} />}
      </div>
      )}
    </li>
  );
}

/**
 * ⋯ on your own post. Its only action is Delete, so it opens the confirm sheet straight away: big
 * phone-sized buttons instead of a tiny pop-up menu (Dan, 2026-11-17).
 */
function PostMenu({ title, onDelete }: { title: string; onDelete: () => void }) {
  return (
    <div className="feed-post__menu">
      <IconButton label={`Options for ${title}`} icon="more" look="plain" aria-haspopup="dialog" onClick={onDelete} />
    </div>
  );
}

function ActivityRow({ line, now, who, friend, children }: { line: ActivityLine; now: Date; who: PublicUser | null; friend: boolean; children?: ReactNode }) {
  const me = useSessionMe();
  const own = who === null;
  // A non-friend's entry page is friends-only, so their title is plain text; the name still opens their profile.
  const title = own || friend ? (
    <Link className="activity-line__title" state={backState('Activity')} to={own ? `/entry/${line.entryId}` : `/u/${who.username}/entry/${line.entryId}`}>
      <strong>{line.title}</strong>
    </Link>
  ) : (
    <strong className="activity-line__title">{line.title}</strong>
  );
  const name = own ? <strong>You</strong> : <Link className="activity-line__name" to={`/u/${who.username}`}>{nameOf(who)}</Link>;
  // Songs and albums: the artist follows the title ("Blinding Lights · The Weeknd"); other lists get a muted line of their own.
  const music = line.category === 'songs' || line.category === 'albums';
  const by = music && line.creator ? <span className="activity-line__by"> · {line.creator}</span> : null;
  const status = line.status ? statusText(line.status.to as Status, line.category) : null;
  let sentence: ReactNode;
  if (line.added) {
    sentence = (
      <>
        {name} added {title}{by} to {listLabel(line.category)}
        {line.rating && ` · rated ${formatRating(line.rating.to)}`}
        {status && ` · marked ${status}`}
      </>
    );
  } else if (line.rating) {
    const { from, to } = line.rating;
    sentence = (
      <>
        {name} {from === null ? 'rated' : 're-rated'} {title}{by}{' '}
        {from === null ? formatRating(to) : `${formatRating(from)} → ${formatRating(to)}`}
        {status && ` · marked ${status}`}
      </>
    );
  } else {
    const w = line.status ? statusPhrase(line.status.to as Status, line.category, own) : { verb: 'updated', suffix: '' };
    sentence = <>{name} {w.verb} {title}{by}{w.suffix}</>;
  }
  return (
    <div className="activity-line">
      {own
        ? <Avatar me={me} size={36} className="activity-line__avatar" />
        : <Avatar user={who} size={36} className="activity-line__avatar" />}
      <div className="activity-line__text">
        <span className="activity-line__sentence">{sentence}</span>
        {!music && line.creator && <span className="activity-line__creator">{line.creator}</span>}
        <time className="activity-line__time" dateTime={line.at}>{timeAgo(line.at, now)}</time>
        {children}
      </div>
      <span aria-hidden="true" className="activity-line__cover">
        <CoverImage src={line.coverUrl} alt={`${line.title} cover`} square={listCfg(line.category).square} width={48} />
      </span>
    </div>
  );
}

/** The person's note on the title, as a short quote: 3 lines, with More / Less when there is more. */
function PostNote({ text, who }: { text: string; who: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const el = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || open) return;
    const measure = () => {
      // Without layout (tests) fall back to a length guess.
      setOverflows(node.clientHeight > 0 ? node.scrollHeight > node.clientHeight + 1 : text.length > 160 || text.split('\n').length > 3);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text, open]);
  return (
    <blockquote className="feed-post__note" aria-label={`${who}'s note`}>
      <p ref={el} className={open ? 'feed-post__note-text' : 'feed-post__note-text feed-post__note-text--clamped'}>{text}</p>
      {(overflows || open) && (
        <button type="button" className="feed-post__note-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Less' : 'More'}
        </button>
      )}
    </blockquote>
  );
}
