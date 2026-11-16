import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAdmin, useApproveEmail, useCopy, useRemoveAccess, type AdminData, type ApprovedInvite } from '../data/social';
import { Button } from '../design/components/Button';
import { EmptyState } from '../design/components/EmptyState';
import { Sheet } from '../design/components/Sheet';
import { Skeleton } from '../design/components/Skeleton';
import { useToast } from '../design/components/Toast';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import '../design/social.css';

const NOT_SET_UP = "Admin invites aren't set up yet. See SETUP step 12.";

/** Plain words for an admin API error. */
export function adminError(err: unknown, action: 'approve' | 'remove'): string {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.error === 'not_configured') return NOT_SET_UP;
    if (err.status === 502 || err.error === 'cloudflare') {
      const message = (err.body as { message?: unknown } | undefined)?.message;
      return `Cloudflare refused: ${typeof message === 'string' && message ? message : 'no reason given'}`;
    }
    if (err.error === 'bad_email') return "That doesn't look like an email address.";
    if (err.error === 'self') return "That's your own email. You can't remove your own access.";
    if (err.error === 'last_rule') return "That's the last approved email. Cloudflare needs at least one, so it can't be removed.";
    if (err.status === 403) return 'Only the admin can do this.';
  }
  return action === 'approve' ? "Couldn't approve that email. Check your connection and try again." : "Couldn't remove access. Check your connection and try again.";
}

interface Row { email: string; joinedAs: string | null; invitedAt: string | null }

/** Everyone who can sign in, newest invite first: invited emails, then people who joined without an invite row. */
function rowsOf(data: AdminData, hidden: Set<string>): Row[] {
  const invited = data.invites.map((i) => ({ email: i.email, joinedAs: i.joined?.username ?? null, invitedAt: i.invitedAt }));
  const known = new Set(invited.map((r) => r.email.toLowerCase()));
  const others = data.users.filter((u) => !known.has(u.email.toLowerCase()))
    .map((u) => ({ email: u.email, joinedAs: u.username, invitedAt: null }));
  return [...invited, ...others].filter((r) => !hidden.has(r.email.toLowerCase()));
}

/** Admin (route /admin, admin only): approve an email, copy the link to send, remove access. */
export function AdminScreen() {
  const me = useSessionMe();
  const { data, isPending, isError, refetch } = useAdmin();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const header = <PageHeader title="Admin" backTo="/more" backUsesHistory />;

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
  const rows = rowsOf(data, hidden);
  return (
    <div className="screen">
      {header}
      <div className="screen__body social-page">
        <InviteForm />
        <section aria-labelledby="admin-approved" className="group">
          <h2 id="admin-approved" className="group__title">Approved · {data.seats.used} of {data.seats.total}</h2>
          {rows.length === 0 ? (
            <p className="friend-note">Nobody yet. Approve an email above to invite someone.</p>
          ) : (
            <ul className="people plain-list">
              {rows.map((r) => {
                const own = r.email.toLowerCase() === me.email.trim().toLowerCase();
                return (
                  <li key={r.email} className="person">
                    <span className="person__meta">
                      <span className="person__name">{r.email}</span>
                      <span className="person__sub">{own ? 'You' : r.joinedAs ? `Joined as @${r.joinedAs}` : 'Not joined yet'}</span>
                    </span>
                    {!own && <Button compact aria-label={`Remove access for ${r.email}`} onClick={() => setRemoving(r.email)}>Remove access</Button>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      {removing && (
        <RemoveSheet email={removing} onClose={() => setRemoving(null)}
          onRemoved={() => { setHidden((h) => new Set(h).add(removing.toLowerCase())); setRemoving(null); }} />
      )}
    </div>
  );
}

function InviteForm() {
  const approve = useApproveEmail();
  const copy = useCopy();
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<ApprovedInvite | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setError(null);
    setResult(null);
    try {
      setResult(await approve.mutateAsync(value));
      setEmail('');
    } catch (err) {
      setError(adminError(err, 'approve'));
    }
  }

  return (
    <section aria-labelledby="admin-invite" className="group">
      <h2 id="admin-invite" className="group__title">Invite a friend</h2>
      <form className="admin-invite" onSubmit={(e) => void submit(e)} noValidate>
        <div className={`text-field${error ? ' has-error' : ''}`}>
          <input type="email" value={email} placeholder="friend@example.com" aria-label="Email" autoComplete="off" autoCapitalize="none"
            spellCheck={false} aria-invalid={error ? true : undefined} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
        </div>
        <Button type="submit" variant="primary" disabled={approve.isPending || !email.trim()}>{approve.isPending ? 'Approving…' : 'Approve'}</Button>
      </form>
      {error && <p role="alert" className="field-error">{error}</p>}
      {result && (
        <div className="admin-result" role="status" aria-label="Approval result">
          <b>{result.alreadyAllowed ? `${result.email} could already sign in` : `Approved ${result.email}`}</b>
          <span className="hint">Send them this link. It opens the app and offers to add you as a friend.</span>
          <div className="admin-result__link">
            <input className="link-box" readOnly value={result.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={() => void copy(result.link)}>Copy</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function RemoveSheet({ email, onClose, onRemoved }: { email: string; onClose: () => void; onRemoved: () => void }) {
  const remove = useRemoveAccess();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    try {
      const { removed } = await remove.mutateAsync(email);
      toast.show(removed ? `Removed access for ${email}` : `${email} was already off the list`);
      onRemoved();
    } catch (err) {
      setError(adminError(err, 'remove'));
    }
  }

  return (
    <Sheet open title={`Remove access for ${email}?`} onClose={onClose}
      footer={
        <div className="btn-row">
          <Button className="btn--danger" disabled={remove.isPending} onClick={() => void go()}>{remove.isPending ? 'Removing…' : 'Remove access'}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      }>
      <p className="hint">They won't be able to sign in. Their data stays.</p>
      {error && <p role="alert" className="field-error">{error}</p>}
    </Sheet>
  );
}
