import { nameOf, type PublicUser } from '@media-tracker/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useAdmin, useAdminAction, useCopy, useResetLink, type AdminAction } from '../data/social';
import { Button } from '../design/components/Button';
import { EmptyState } from '../design/components/EmptyState';
import { IconButton } from '../design/components/IconButton';
import { Sheet } from '../design/components/Sheet';
import { Skeleton } from '../design/components/Skeleton';
import { useToast } from '../design/components/Toast';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { PersonAvatar } from './social/parts';
import '../design/social.css';

const DONE: Record<AdminAction | 'restore', string> = { approve: 'Approved', decline: 'Declined', remove: 'Removed', restore: 'Restored' };
const VERB: Record<AdminAction | 'restore', string> = { approve: 'approve', decline: 'decline', remove: 'remove', restore: 'restore' };

/** "2 h ago", "1 d ago", "just now" (a request's age; Admin refetches on open, so no timer). */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return mins < 24 * 60 ? `${Math.floor(mins / 60)} h ago` : '1 d ago';
  return `${Math.floor(mins / (24 * 60))} d ago`;
}

/** Plain words for a failed admin call. */
export function adminError(err: unknown, action: AdminAction | 'restore' | 'reset', handle: string): string {
  if (err instanceof ApiError) {
    if (err.error === 'self') return "You can't remove your own access.";
    if (err.status === 403) return 'Only the admin can do this.';
    if (err.status === 404) return `${handle} has already changed. Refresh and look again.`;
  }
  const what = action === 'reset' ? 'make a reset link for' : VERB[action];
  return `Couldn't ${what} ${handle}. Check your connection and try again.`;
}

const handleOf = (u: Pick<PublicUser, 'username'>) => `@${u.username}`;

function Row({ user, sub, children }: { user: PublicUser; sub?: ReactNode; children?: ReactNode }) {
  const named = !!user.displayName;
  return (
    <li className="person person--admin">
      <PersonAvatar user={user} size={36} />
      <span className="person__meta">
        <span className="person__name">{nameOf(user)}</span>
        {(named || sub) && <span className="person__sub">{named ? handleOf(user) : null}{named && sub ? ' · ' : null}{sub}</span>}
      </span>
      {children}
    </li>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="group">
      <h2 id={id} className="group__title">{count === undefined ? title : `${title} · ${count}`}</h2>
      {children}
    </section>
  );
}

type Confirm = { kind: 'decline' | 'remove'; user: PublicUser };

/** Admin (route /admin, admin only): approve or decline sign-ups, reset passwords, remove and restore people. */
export function AdminScreen() {
  const me = useSessionMe();
  const { data, isPending, isError, refetch } = useAdmin();
  const act = useAdminAction();
  const makeLink = useResetLink();
  const copy = useCopy();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [link, setLink] = useState<{ user: PublicUser; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const header = <PageHeader title="Admin" backTo="/more" backUsesHistory />;

  async function run(user: PublicUser, action: AdminAction, label: AdminAction | 'restore' = action): Promise<boolean> {
    setBusy(user.id);
    setError(null);
    try {
      await act.mutateAsync({ id: user.id, action });
      toast.show(`${DONE[label]} ${handleOf(user)}`);
      return true;
    } catch (err) {
      const msg = adminError(err, label, handleOf(user));
      setError(msg);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function resetLink(user: PublicUser) {
    setBusy(user.id);
    setError(null);
    try {
      const { link: url } = await makeLink.mutateAsync(user.id);
      setLink({ user, url });
    } catch (err) {
      const msg = adminError(err, 'reset', handleOf(user));
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  if (isPending) {
    return (
      <div className="screen" aria-busy="true" aria-label="Loading">
        {header}
        <div className="screen__body stack-10"><Skeleton height={50} /><Skeleton height={64} /><Skeleton height={64} /></div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="screen">
        {header}
        <div className="screen__body">
          <EmptyState icon="info" title="Couldn't load Admin" body="Check your connection and try again." actionLabel="Retry" onAction={() => void refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
      <div className="screen__body social-page">
        {error && <p role="alert" className="field-error">{error}</p>}
        <Section id="admin-requests" title="Requests" count={data.pending.length}>
          {data.pending.length === 0 ? (
            <p className="friend-note">No requests right now.</p>
          ) : (
            <ul className="people plain-list">
              {data.pending.map((u) => (
                <Row key={u.id} user={u} sub={`asked ${ago(u.requestedAt)}`}>
                  <Button variant="primary" compact aria-label={`Approve ${handleOf(u)}`} disabled={busy === u.id} onClick={() => void run(u, 'approve')}>Approve</Button>
                  <Button compact aria-label={`Decline ${handleOf(u)}`} disabled={busy === u.id} onClick={() => setConfirm({ kind: 'decline', user: u })}>Decline</Button>
                </Row>
              ))}
            </ul>
          )}
        </Section>

        <Section id="admin-members" title="Members" count={data.active.length}>
          <ul className="people plain-list">
            {data.active.map((u) => (
              <Row key={u.id} user={u}>
                {u.id === me.id ? <span className="person__you">You</span> : (
                  <RowMenu user={u} disabled={busy === u.id} onReset={() => void resetLink(u)} onRemove={() => setConfirm({ kind: 'remove', user: u })} />
                )}
              </Row>
            ))}
          </ul>
          {link && (
            <div className="admin-result" role="status" aria-label="Reset link">
              <b>Send this to {handleOf(link.user)}:</b>
              <div className="admin-result__link">
                <input className="link-box" readOnly value={link.url} aria-label="Reset link" onFocus={(e) => e.currentTarget.select()} />
                <Button onClick={() => void copy(link.url)}>Copy</Button>
              </div>
              <span className="hint">Works once, for 24 hours.</span>
            </div>
          )}
        </Section>

        {data.removed.length > 0 && (
          <Section id="admin-removed" title="Removed" count={data.removed.length}>
            <ul className="people plain-list">
              {data.removed.map((u) => (
                <Row key={u.id} user={u}>
                  <Button compact aria-label={`Restore ${handleOf(u)}`} disabled={busy === u.id} onClick={() => void run(u, 'approve', 'restore')}>Restore</Button>
                </Row>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {confirm && (
        <Sheet open title={confirm.kind === 'decline' ? `Decline ${handleOf(confirm.user)}?` : `Remove ${handleOf(confirm.user)}?`} onClose={() => setConfirm(null)}
          footer={
            <div className="btn-row">
              <Button className="btn--danger" disabled={busy === confirm.user.id}
                onClick={() => void run(confirm.user, confirm.kind).then((ok) => { if (ok) setConfirm(null); })}>
                {confirm.kind === 'decline' ? 'Decline' : 'Remove access'}
              </Button>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
            </div>
          }>
          <p className="hint">
            {confirm.kind === 'decline' ? "The request is deleted. They can sign up again if they want to." : "They won't be able to sign in. Their data stays."}
          </p>
        </Sheet>
      )}
    </div>
  );
}

/** The ⋯ button on a member's row: Reset password link, Remove access. */
function RowMenu({ user, disabled, onReset, onRemove }: { user: PublicUser; disabled: boolean; onReset: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="person__menu" ref={wrap}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); wrap.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus(); } }}>
      <IconButton label={`More actions for ${handleOf(user)}`} icon="more" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div role="menu" aria-label={`Actions for ${handleOf(user)}`} className="menu">
          <button type="button" role="menuitem" className="menu__item" onClick={pick(onReset)}>Reset password link</button>
          <button type="button" role="menuitem" className="menu__item" onClick={pick(onRemove)}>Remove access</button>
        </div>
      )}
    </div>
  );
}
