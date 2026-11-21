import { nameOf, type PublicUser } from '@media-tracker/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useReactionsWho, type SocialTarget } from '../../data/feed';
import { Avatar } from '../../design/components/Avatar';
import { Sheet } from '../../design/components/Sheet';
import { useSessionMe } from '../../shell/SessionGate';
import '../../design/feed.css';

/**
 * "Who reacted": a quiet text button next to the reaction chips that opens the "Reactions" sheet,
 * with "All n" and one tab per emoji, each listing the people (a tap opens their profile).
 */
export function WhoReactedButton({ target, title }: { target: SocialTarget; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="who-btn" aria-label={`See who reacted to ${title}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Who reacted
      </button>
      {open && <WhoReactedSheet target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

const ALL = 'all';

export function WhoReactedSheet({ target, onClose }: { target: SocialTarget; onClose: () => void }) {
  const me = useSessionMe();
  const who = useReactionsWho(target);
  const [tab, setTab] = useState(ALL);
  const groups = who.data ?? [];
  const total = groups.reduce((n, g) => n + g.users.length, 0);
  const tabs = [{ key: ALL, label: `All ${total}`, users: null as null | PublicUser[] }, ...groups.map((g) => ({ key: g.emoji, label: `${g.emoji} ${g.users.length}`, users: g.users }))];
  const current = tabs.find((t) => t.key === tab) ?? tabs[0]!;
  // "All": one row per person per emoji they used, grouped by emoji in the same order as the tabs.
  const rows = current.users
    ? current.users.map((u) => ({ u, emoji: null as string | null }))
    : groups.flatMap((g) => g.users.map((u) => ({ u, emoji: g.emoji })));

  return (
    <Sheet open title="Reactions" onClose={onClose}>
      {who.isPending ? (
        <p className="comment-empty" aria-busy="true">Loading…</p>
      ) : who.isError ? (
        <p className="comment-empty">
          Couldn't load reactions. <button type="button" className="link-btn" onClick={() => void who.refetch()}>Try again</button>
        </p>
      ) : total === 0 ? (
        <p className="comment-empty">No reactions yet.</p>
      ) : (
        <>
          <div role="tablist" aria-label="Reactions" className="who-tabs">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" className="who-tab" aria-selected={t.key === current.key} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <ul className="plain-list who-list" role="tabpanel" aria-label={current.label}>
            {rows.map(({ u, emoji }) => {
              const mine = u.id === me.id;
              return (
                <li key={`${emoji ?? ''}${u.id}`}>
                  <Link to={`/u/${u.username}`} className="person who-row" onClick={onClose}>
                    {mine ? <Avatar me={me} size={44} /> : <Avatar user={u} size={44} />}
                    <span className="person__meta">
                      <span className="person__name">{mine ? 'You' : nameOf(u)}</span>
                      <span className="person__sub">@{u.username}</span>
                    </span>
                    {emoji && <span aria-label={`reacted ${emoji}`} className="who-row__emoji">{emoji}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
