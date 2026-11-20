import { TAG_NAME_MAX, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { addTag, removeTag, tagError, useMyTags } from '../../data/tags';
import { Icon } from '../../design/components/Icon';
import { useToast } from '../../design/components/Toast';
import '../../design/tags.css';

/** The title page's Tags row: your chips (each with a remove button) and "+ Add tag", which suggests the tags you already have. */
export function TagsRow({ entry }: { entry: Entry }) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  const mine = useMyTags();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opened = useRef(false);
  // Opening the box focuses it; closing it returns focus to "+ Add tag".
  useEffect(() => {
    if (adding) { opened.current = true; input.current?.focus(); }
    else if (opened.current) { opened.current = false; opener.current?.focus(); }
  }, [adding]);
  const tags = entry.tags ?? [];
  const has = (n: string) => tags.some((t) => t.toLowerCase() === n.toLowerCase());
  const typed = draft.trim().toLowerCase();
  const suggestions = (mine.data ?? []).filter((t) => !has(t.name) && t.name.toLowerCase().includes(typed)).slice(0, 8);

  async function put(raw: string) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name || busy) return;
    if (has(name)) { setDraft(''); return; }
    setBusy(true);
    try {
      await addTag(qc, { ...entry, tags }, name);
      setDraft('');
      input.current?.focus();
    } catch (err) {
      toast.show(tagError(err));
    } finally {
      setBusy(false);
    }
  }
  async function drop(name: string) {
    try {
      await removeTag(qc, { ...entry, tags }, name);
    } catch (err) {
      toast.show(tagError(err));
    }
  }
  function submit(e: FormEvent) { e.preventDefault(); void put(draft); }
  function close() { setAdding(false); setDraft(''); }

  return (
    <section className="detail__section tags-row" aria-labelledby={`${id}-h`}>
      <h2 className="detail__h" id={`${id}-h`}>Tags</h2>
      <ul className="tag-list" aria-label="Your tags on this title">
        {tags.map((t) => (
          <li key={t} className="tag-chip">
            <span>{t}</span>
            <button type="button" className="tag-chip__x" aria-label={`Remove tag ${t}`} onClick={() => void drop(t)}><Icon name="close" size={14} /></button>
          </li>
        ))}
        {!adding && (
          <li><button type="button" ref={opener} className="tag-add" onClick={() => setAdding(true)}>+ Add tag</button></li>
        )}
      </ul>
      {tags.length === 0 && !adding && <p className="field-hint">Your own labels, like "With Ren" or "Rewatch". Friends see them on titles they can see.</p>}
      {adding && (
        <form className="tag-form" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
          <label className="field-label" htmlFor={`${id}-in`}>New tag</label>
          <div className="tag-form__row">
            <input id={`${id}-in`} ref={input} className="input" value={draft} maxLength={TAG_NAME_MAX} autoComplete="off" placeholder="Type a tag…"
              enterKeyHint="done" onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="btn btn--primary btn--compact" disabled={busy || draft.trim() === ''}>Add</button>
            <button type="button" className="btn btn--ghost btn--compact" onClick={close}>Done</button>
          </div>
          {suggestions.length > 0 && (
            <ul className="tag-list tag-suggest" aria-label="Your existing tags">
              {suggestions.map((t) => (
                <li key={t.id}><button type="button" className="tag-add" onClick={() => void put(t.name)}>{t.name}</button></li>
              ))}
            </ul>
          )}
        </form>
      )}
    </section>
  );
}
