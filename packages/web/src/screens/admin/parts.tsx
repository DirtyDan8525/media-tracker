import { THEMES } from '@media-tracker/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { Skeleton } from '../../design/components/Skeleton';
import { EmptyState } from '../../design/components/EmptyState';
import { PageHeader } from '../../shell/PageHeader';
import { useAdminApp, type AdminApp } from '../../data/adminApp';
import '../../design/social.css';
import '../../design/admin.css';

/** Names for the colours an admin may pick (the highlight colours of the built-in themes). */
export const ACCENT_NAMES: Record<string, string> = {
  '#ffd166': 'Gold', '#ff9f43': 'Orange', '#c4a7ff': 'Lavender', '#ff5c6c': 'Coral', '#5fd4ff': 'Sky', '#c8e06b': 'Lime',
  '#9b671a': 'Bronze', '#ce2e68': 'Rose', '#4f7a28': 'Green', '#2563c9': 'Blue', '#8a5a2b': 'Brown',
};
export const accentName = (hex: string): string => ACCENT_NAMES[hex.toLowerCase()] ?? hex;
export const THEME_NAMES: string[] = Object.keys(THEMES);

/** Plain words for a failed settings save. */
export function saveError(err: unknown, what: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'Only the admin can do this.';
    if (err.status === 400) return `That ${what} isn't valid. Check the fields and try again.`;
  }
  return `Couldn't save the ${what}. Check your connection and try again.`;
}

export interface Feedback { kind: 'ok' | 'error'; text: string; n: number }

/** The result of a save, announced and focused: a status (or alert) paragraph the screen renders with <Result>. */
export function useFeedback() {
  const [fb, setFb] = useState<Feedback | null>(null);
  const n = useRef(0);
  const show = (kind: Feedback['kind'], text: string) => setFb({ kind, text, n: ++n.current });
  return { fb, ok: (t: string) => show('ok', t), fail: (t: string) => show('error', t), clear: () => setFb(null) };
}

/** Focuses itself when a new result arrives, so keyboard and screen-reader users land on what happened. */
export function Result({ fb }: { fb: Feedback | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (fb) ref.current?.focus(); }, [fb]);
  if (!fb) return null;
  return fb.kind === 'error'
    ? <p ref={ref} key={fb.n} tabIndex={-1} role="alert" className="field-error admin-feedback">{fb.text}</p>
    : <p ref={ref} key={fb.n} tabIndex={-1} role="status" className="admin-ok admin-feedback">{fb.text}</p>;
}

/** A character counter that reads "52 / 280", and is flagged when over. */
export function Count({ id, n, max }: { id: string; n: number; max: number }) {
  return <span id={id} className={`admin-count${n > max ? ' is-over' : ''}`}>{`${n} / ${max}${n > max ? ' (too long)' : ''}`}</span>;
}

/** A sub-page of Admin: back to Admin, the app settings loaded (a skeleton and a retry around `children`). */
export function AdminPage({ title, children }: { title: string; children: (app: AdminApp) => ReactNode }) {
  const q = useAdminApp();
  const header = <PageHeader title={title} backTo="/admin" backUsesHistory />;
  if (q.isPending) {
    return <div className="screen" aria-busy="true" aria-label="Loading">{header}<div className="screen__body stack-10"><Skeleton height={64} /><Skeleton height={120} /></div></div>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="screen">{header}
        <div className="screen__body">
          <EmptyState icon="info" title={`Couldn't load ${title}`} body="Check your connection and try again." actionLabel="Retry" onAction={() => void q.refetch()} />
        </div>
      </div>
    );
  }
  return <div className="screen">{header}<div className="screen__body admin-page">{children(q.data)}</div></div>;
}

/** A page that needs no app settings (numbers, moderation, tools). */
export function PlainPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="screen">
      <PageHeader title={title} backTo="/admin" backUsesHistory />
      <div className="screen__body admin-page">{children}</div>
    </div>
  );
}
