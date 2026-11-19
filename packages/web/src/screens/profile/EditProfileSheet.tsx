import { BIO_MAX, BIO_MAX_LINES, bioLength, hasLink } from '@media-tracker/shared';
import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import type { Me } from '../../api/types';
import { useSaveBio } from '../../data/bio';
import { useSaveDisplayName } from '../../data/social';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { PublicLinkRow } from '../settings/PublicLinkRow';
import { useToast } from '../../design/components/Toast';
import '../../design/plan.css';

const clean = (s: string) => s.replace(/\r\n?/g, '\n').trim();

/** What is wrong with a bio as typed, in words (null when it is fine). Mirrors the server's rules. */
export function bioProblem(text: string): string | null {
  const t = clean(text);
  if (bioLength(t) > BIO_MAX) return `Keep it to ${BIO_MAX} characters.`;
  if (t.split('\n').length > BIO_MAX_LINES) return `Up to ${BIO_MAX_LINES} lines.`;
  if (hasLink(t)) return "Bios can't have links.";
  return null;
}

/** Edit profile (ProfileBio.wf): Display name and Bio with an "N / 150" counter. */
export function EditProfileSheet({ me, onClose }: { me: Me; onClose: () => void }) {
  const toast = useToast();
  const saveName = useSaveDisplayName();
  const saveBio = useSaveBio();
  const [name, setName] = useState(me.displayName ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [failed, setFailed] = useState<string | null>(null);
  const nameId = useId();
  const bioId = useId();
  const noteId = useId();
  const errId = useId();

  const problem = bioProblem(bio);
  const count = bioLength(clean(bio));
  const nameChanged = clean(name) !== (me.displayName ?? '');
  const bioChanged = clean(bio) !== (me.bio ?? '');
  const busy = saveName.isPending || saveBio.isPending;
  const error = problem ?? failed;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem || busy) return;
    setFailed(null);
    try {
      if (nameChanged) await saveName.mutateAsync(clean(name) === '' ? null : clean(name));
    } catch {
      setFailed("Couldn't save your display name. Check your connection and try again.");
      return;
    }
    try {
      if (bioChanged) await saveBio.mutateAsync(clean(bio));
    } catch (err) {
      setFailed(err instanceof ApiError && err.error === 'no_links' ? "Bios can't have links." : "Couldn't save your bio. Check your connection and try again.");
      return;
    }
    toast.show('Profile saved');
    onClose();
  }

  return (
    <Sheet
      open title="Edit profile" onClose={onClose}
      footer={<Button type="submit" form="edit-profile-form" variant="primary" className="btn--block" disabled={busy || !!problem}>{busy ? 'Saving…' : 'Save'}</Button>}
    >
      <form id="edit-profile-form" className="stack-10" onSubmit={(e) => void submit(e)} noValidate>
        <div className="stack-4">
          <label htmlFor={nameId} className="field-label">Display name</label>
          <div className="text-field">
            <input id={nameId} type="text" value={name} maxLength={40} autoComplete="nickname" enterKeyHint="next"
              onChange={(e) => { setName(e.target.value); setFailed(null); }} />
          </div>
        </div>
        <div className="stack-4">
          <label htmlFor={bioId} className="field-label">Bio</label>
          <textarea id={bioId} className="bio-field" rows={4} value={bio} spellCheck
            aria-describedby={`${noteId}${error ? ` ${errId}` : ''}`} aria-invalid={error ? true : undefined}
            onChange={(e) => { setBio(e.target.value); setFailed(null); }} />
          <div className={`bio-counter${count > BIO_MAX ? ' is-over' : ''}`}>{count} / {BIO_MAX}</div>
          <span id={noteId} className="field-hint">Line breaks and emoji are fine. No links.</span>
          {error && <p id={errId} role="alert" className="field-error">{error}</p>}
        </div>
      </form>
      <section aria-label="Public profile link" className="group__card edit-profile__public">
        <PublicLinkRow />
      </section>
    </Sheet>
  );
}
