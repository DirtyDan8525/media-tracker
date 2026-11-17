import { useState } from 'react';
import { inviteLink, searchable, useCopy, useInviteCode, useRegenerateCode, useUserSearch } from '../../data/social';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { useDebounced } from './parts';
import { PeopleList } from './PeopleList';
import '../../design/social.css';

/** Add friend (AddFriend.wf): find someone by username, or hand them your invite link. */
export function AddFriendSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open title="Add friend" onClose={onClose}>
      <AddFriendBody />
    </Sheet>
  );
}

function AddFriendBody() {
  const [text, setText] = useState('');
  const query = useDebounced(text);
  const search = useUserSearch(query);

  const waiting = (text.trim() === '' || searchable(text)) && (text !== query || search.isFetching) && !search.data;
  return (
    <div className="add-friend">
      <div className="stack-10">
        <label htmlFor="add-friend-q" className="field-label">Username</label>
        <div className="text-field">
          <span className="text-field__prefix" aria-hidden="true">@</span>
          <input id="add-friend-q" type="text" value={text} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            maxLength={21} enterKeyHint="search" aria-label="Username" onChange={(e) => setText(e.target.value)} />
        </div>
        <div aria-live="polite">
          {text.trim() !== '' && !searchable(text) ? (
            <p className="hint">Type at least 2 letters or numbers of their username.</p>
          ) : waiting ? (
            <Skeleton height={64} />
          ) : search.isError ? (
            <p className="hint">Couldn't search. Check your connection and try again.</p>
          ) : search.data && search.data.length === 0 ? (
            <p className="hint">{text.trim() === '' ? 'No one else has an account yet. Send them your invite link below.' : 'No one has that username. Check the spelling, or send them your invite link below.'}</p>
          ) : (
            <PeopleList users={search.data ?? []} label={text.trim() === '' ? 'Everyone' : 'Search results'} />
          )}
        </div>
      </div>
      <InviteLink />
    </div>
  );
}

function InviteLink() {
  const code = useInviteCode();
  const regen = useRegenerateCode();
  const copy = useCopy();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const link = code.data ? inviteLink(code.data) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function share() {
    try {
      await navigator.share({ title: 'Media Tracker', text: 'Add me on Media Tracker', url: link });
    } catch {
      // closed without sharing: nothing to say
    }
  }

  return (
    <section aria-labelledby="add-friend-link" className="add-friend__link">
      <h3 id="add-friend-link" className="group__title">Your invite link</h3>
      {code.isError ? (
        <p className="hint">Couldn't load your link. <Button variant="ghost" compact onClick={() => void code.refetch()}>Try again</Button></p>
      ) : !code.data ? (
        <Skeleton height={50} />
      ) : confirm ? (
        <div className="confirm" role="group" aria-label="Make a new link">
          <p className="confirm__title">Make a new link?</p>
          <p className="hint">The old link will stop working. Anyone you sent it to will need the new one.</p>
          <div className="btn-row">
            <Button variant="primary" disabled={regen.isPending}
              onClick={() => regen.mutate(undefined, {
                onSuccess: () => { setConfirm(false); toast.show('New link ready'); },
                onError: () => toast.show("Couldn't make a new link. Try again."),
              })}>Make new link</Button>
            <Button onClick={() => setConfirm(false)}>Keep old link</Button>
          </div>
        </div>
      ) : (
        <>
          <input className="link-box" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <div className="btn-row">
            <Button onClick={() => void copy(link)}>Copy</Button>
            {canShare && <Button onClick={() => void share()}>Share</Button>}
          </div>
          <Button variant="ghost" onClick={() => setConfirm(true)}>Make a new link</Button>
        </>
      )}
    </section>
  );
}
