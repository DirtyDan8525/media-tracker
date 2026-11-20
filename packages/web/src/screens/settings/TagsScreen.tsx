import { TAG_NAME_MAX, type TagInfo } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import { tagsChanged, useMyTags } from '../../data/tags';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Sheet } from '../../design/components/Sheet';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { PageHeader } from '../../shell/PageHeader';
import '../../design/settings.css';
import '../../design/tags.css';

export const TAGS_PATH = '/settings/tags';

/** Settings → Tags: every tag you made, with how many titles carry it; rename or delete one everywhere. */
export function TagsScreen() {
  const { data, isPending, isError, refetch } = useMyTags();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TagInfo | null>(null);
  return (
    <div className="screen">
      <PageHeader title="Tags" backTo="/settings" backUsesHistory />
      <div className="screen__body stack-18">
        <section aria-labelledby="set-tags" className="group">
          <h2 id="set-tags" className="group__title">Your tags</h2>
          {isPending ? (
            <div aria-busy="true" aria-label="Loading tags" className="stack-10"><Skeleton height={48} /><Skeleton height={48} /></div>
          ) : isError ? (
            <EmptyState icon="info" title="Couldn't load your tags" body="Check your connection and try again." actionLabel="Retry" onAction={() => void refetch()} />
          ) : data.length === 0 ? (
            <EmptyState icon="info" title="No tags yet" body={'Open a title and tap "+ Add tag" to make your first one.'} />
          ) : (
            <ul className="group__card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.map((t) => (
                <li key={t.id} className="group__row">
                  {renaming === t.id
                    ? <RenameForm tag={t} onDone={() => setRenaming(null)} />
                    : (
                      <>
                        <span className="tag-manage__name">{t.name} <span className="group__value">{t.count === 1 ? '1 title' : `${t.count} titles`}</span></span>
                        <span className="group__row-end">
                          <Button variant="ghost" compact aria-label={`Rename tag ${t.name}`} onClick={() => setRenaming(t.id)}>Rename</Button>
                          <Button variant="ghost" compact aria-label={`Delete tag ${t.name}`} onClick={() => setDeleting(t)}>Delete</Button>
                        </span>
                      </>
                    )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {deleting && <DeleteTagSheet tag={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function RenameForm({ tag, onDone }: { tag: TagInfo; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  const errId = useId();
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = name.trim().replace(/\s+/g, ' ');
    if (next === '') { setError('A tag is 1 to 30 characters.'); return; }
    if (next === tag.name) { onDone(); return; }
    setBusy(true);
    try {
      await api.patch(`/api/tags/${tag.id}`, { name: next });
      tagsChanged(qc);
      toast.show('Tag renamed');
      onDone();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError && err.error === 'exists' ? 'You already have a tag with that name.' : "Couldn't rename it. Try again.");
    }
  }
  return (
    <form className="tag-manage__form" onSubmit={(e) => void submit(e)} noValidate
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }}>
      <label htmlFor={id} className="sr-only">New name for {tag.name}</label>
      <input id={id} className="input" value={name} maxLength={TAG_NAME_MAX} autoFocus autoComplete="off"
        aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
        onChange={(e) => { setName(e.target.value); setError(''); }} />
      <Button type="submit" variant="primary" compact disabled={busy}>Save</Button>
      <Button variant="ghost" compact onClick={onDone}>Cancel</Button>
      {error && <p id={errId} role="alert" className="field-error">{error}</p>}
    </form>
  );
}

function DeleteTagSheet({ tag, onClose }: { tag: TagInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await api.del(`/api/tags/${tag.id}`);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) { setBusy(false); toast.show("Couldn't delete that. Try again."); return; }
    }
    tagsChanged(qc);
    toast.show(`Deleted tag ${tag.name}`);
    onClose();
  }
  return (
    <Sheet open title="Delete this tag?" onClose={onClose}
      footer={(
        <div className="detail__actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button className="btn--danger" disabled={busy} onClick={() => void remove()}>Delete</Button>
        </div>
      )}>
      <p>"{tag.name}" will be removed from {tag.count === 1 ? '1 title' : `${tag.count} titles`}. The titles stay.</p>
    </Sheet>
  );
}
