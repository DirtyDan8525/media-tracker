import { useAdminNumbers } from '../../data/adminApp';
import { EmptyState } from '../../design/components/EmptyState';
import { Skeleton } from '../../design/components/Skeleton';
import { PlainPage } from './parts';
import { listLabel } from '../../lists/registry';

/** /admin/numbers (AD9): who is using the app, and what is rated most. Non-private entries only. */
export function NumbersScreen() {
  const q = useAdminNumbers();
  return (
    <PlainPage title="Numbers">
      {q.isPending ? <div aria-busy="true" aria-label="Loading" className="stack-10"><Skeleton height={64} /><Skeleton height={64} /></div>
        : q.isError || !q.data ? <EmptyState icon="info" title="Couldn't load the numbers" body="Check your connection and try again." actionLabel="Retry" onAction={() => void q.refetch()} />
        : (
          <>
            <section aria-labelledby="num-title" className="group">
              <h2 id="num-title" className="group__title">Numbers</h2>
              <dl className="admin-stats">
                <Stat label="Members" value={q.data.members} />
                <Stat label="Active, 7 days" value={q.data.active7} />
                <Stat label="Titles added" value={q.data.titles7} />
                <Stat label="Messages" value={q.data.messages7} />
              </dl>
            </section>
            <section aria-labelledby="num-top" className="group">
              <h2 id="num-top" className="group__title">Most rated · top 10 (non-private)</h2>
              {q.data.mostRated.length === 0 ? <p className="friend-note">Nothing rated yet.</p> : (
                <div className="admin-card">
                  <ol className="admin-rank">
                    {q.data.mostRated.map((r, i) => (
                      <li key={`${r.category}:${r.title}`}>
                        <span className="admin-rank__n">{i + 1}</span>
                        <span className="admin-rank__title">{r.title} <span className="muted">· {listLabel(r.category)}</span></span>
                        <span className="admin-rank__count" aria-label={`rated by ${r.count} ${r.count === 1 ? 'person' : 'people'}`}>{r.count}×</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          </>
        )}
    </PlainPage>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="admin-stat"><div><dt>{label}</dt><dd>{value}</dd></div></div>;
}
