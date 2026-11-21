import { findDuplicate, formatRating, nameOf, type ActivityLine, type Features, type FriendEntry, type PostSocial, type PublicUser, type Reaction, type Status } from '@media-tracker/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAddToMine } from '../../data/social';
import { useEntries } from '../../data/useEntries';
import { useToast } from '../../design/components/Toast';
import { OpenInSpotify } from '../entry/OpenInSpotify';
import { PlayPreview } from '../entry/PlayPreview';
import { PlayTrailer } from '../entry/PlayTrailer';
import { WatchOnYouTube } from '../entry/WatchOnYouTube';
import { useReact, useReactionsWho, type SocialTarget } from '../../data/feed';
import { Avatar } from '../../design/components/Avatar';
import { Button } from '../../design/components/Button';
import { CoverImage } from '../../design/components/CoverImage';
import { RatingBadge } from '../../design/components/RatingBadge';
import { backState } from '../../shell/BackButton';
import { useSessionMe } from '../../shell/SessionGate';
import { CommentList } from '../social/CommentsSheet';
import { ReactButton, ReactionChips } from '../social/ReactionBar';
import { timeAgo } from './format';
import { listCfg, listLabel, statusText } from '../../lists/registry';

type DetailsProps = {
  line: ActivityLine; who: PublicUser | null; friend: boolean; social: PostSocial; features: Features; now: Date; onComment: () => void;
};

/** PC: the right-hand panel of Activity. Empty (with a hint) until a post is hovered, focused or clicked. */
export function ActivityPanel({ props }: { props: DetailsProps | null }) {
  return (
    <aside className="activity-panel" aria-label="Post details">
      {props
        ? <PostDetails key={props.line.key} {...props} />
        : <p className="activity-panel__hint">Hover a post to see the details</p>}
    </aside>
  );
}

/** One post in full. The PC panel and the phone sheet both show this; its buttons fetch on mount, so mount it only for the post shown. */
export function PostDetails({ line, who, friend, social, features, now, onComment }: DetailsProps) {
  const me = useSessionMe();
  const own = who === null;
  const react = useReact();
  const target: SocialTarget = { activityId: line.key, entryId: line.entryId };
  const toggle = (emoji: Reaction) => react.mutate({ target, emoji });
  const reacted = useReactionsWho(features.reactions && Object.keys(social.reactions).length > 0 ? target : null);
  const config = listCfg(line.category);
  const status = line.status ? statusText(line.status.to as Status, line.category) : null;
  const to = own ? `/entry/${line.entryId}` : friend ? `/u/${who.username}/entry/${line.entryId}` : null;
  const addToMine = useAddToMine();
  const toast = useToast();
  // Someone else's custom list is theirs alone: nothing of yours to look in, and nothing to copy it to.
  const copyable = !config.custom || own;
  const mine = useEntries(line.category, copyable).data;
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onList = added ?? (own ? line.entryId : mine ? findDuplicate(mine, { title: line.entryTitle, creator: line.creator }, line.category) : null);
  async function add() {
    setBusy(true);
    try {
      const copy: FriendEntry = {
        id: '', userId: '', category: line.category, title: line.entryTitle, status: null, rating: null, tier: null, genres: '', creator: line.creator,
        album: '', coverUrl: line.coverUrl, releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none', source: null,
        sourceId: null, seasonAvg: null, createdAt: '', notes: null,
      };
      const r = await addToMine(copy);
      setAdded(r.entryId);
      if (!r.duplicate) toast.show(`Added ${line.entryTitle} to your list`);
    } catch {
      toast.show("Couldn't add it. Try again.");
    } finally {
      setBusy(false);
    }
  }
  // The shared entry buttons take what the feed knows; the rest (source ids, release year) is looked up by title.
  // Source ids let Play preview / trailer fetch the exact title, as on the title page (Dan, 2026-11-20).
  const media = { category: line.category, title: line.entryTitle, creator: line.creator, releaseDate: line.releaseDate, source: line.source, sourceId: line.sourceId };
  return (
    <div className="activity-details">
      <div className="activity-panel__top">
        <CoverImage src={line.coverUrl} alt={`${line.title} cover`} square={config.square} width={112} />
        <div className="activity-panel__titles">
          <h2 className="activity-panel__title">{line.title}</h2>
          {line.creator && <p className="activity-panel__creator">{line.creator}</p>}
          <p className="activity-panel__meta">{listLabel(line.category)}</p>
          {to && <Link className="activity-panel__open" to={to} state={backState('Activity')}>Open</Link>}
        </div>
      </div>
      <div className="activity-panel__who">
        {own ? <Avatar me={me} size={36} /> : <Avatar user={who} size={36} />}
        <div>
          <strong>{own ? 'You' : nameOf(who)}</strong>
          <time className="activity-panel__time" dateTime={line.at}>{timeAgo(line.at, now)}</time>
        </div>
        {line.rating && <RatingBadge rating={line.rating.to} size="md" />}
      </div>
      <div className="activity-panel__actions">
        <OpenInSpotify entry={media} />
        <PlayPreview entry={media} />
        <PlayTrailer entry={media} />
        <WatchOnYouTube entry={media} />
        {!own && copyable && (onList
          ? <Link className="btn btn--secondary detail__watch" to={`/entry/${onList}`}>On your list</Link>
          : <Button variant="secondary" className="detail__watch" disabled={busy} onClick={() => void add()}>Add to mine</Button>)}
      </div>
      <dl className="activity-panel__facts">
        {line.rating && <><dt>Rating</dt><dd>{line.rating.from === null ? formatRating(line.rating.to) : `${formatRating(line.rating.from)} → ${formatRating(line.rating.to)}`}</dd></>}
        {status && <><dt>Status</dt><dd>{status}</dd></>}
      </dl>
      {line.note && (
        <section aria-label="Note">
          <h3 className="activity-panel__h">Note</h3>
          <blockquote className="feed-post__note"><p className="feed-post__note-text">{line.note}</p></blockquote>
        </section>
      )}
      {features.reactions && (
        <section aria-label="Reactions">
          <h3 className="activity-panel__h">Reactions</h3>
          <div className="feed-post__chips">
            <ReactionChips social={social} onToggle={toggle} />
            <ReactButton mine={social.mine} onPick={toggle} />
          </div>
          {reacted.data && reacted.data.length > 0 && (
            <ul className="plain-list activity-panel__reacted">
              {reacted.data.map((g) => (
                <li key={g.emoji}><span aria-hidden="true">{g.emoji}</span> {g.users.map((u) => nameOf(u)).join(', ')}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {features.comments && (
        <section aria-label="Comments">
          <h3 className="activity-panel__h">Comments{social.comments > 0 ? ` (${social.comments})` : ''}</h3>
          <CommentList target={target} />
          <Button variant="secondary" onClick={onComment}>Add a comment</Button>
        </section>
      )}
    </div>
  );
}
