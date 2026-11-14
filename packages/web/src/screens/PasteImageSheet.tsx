import { useId, useState, type FormEvent } from 'react';
import { Button } from '../design/components/Button';
import { Sheet } from '../design/components/Sheet';
import { isHttpUrl } from '../lookup/query';

export interface PasteImageSheetProps {
  title: string;
  onSave: (url: string) => void;
  onClose: () => void;
}

export const LINK_ERROR = 'Enter a link that starts with http:// or https://';

/** Paste a cover link for an entry the lookup couldn't find. Only http(s) links are accepted. */
export function PasteImageSheet({ title, onSave, onClose }: PasteImageSheetProps) {
  const id = useId();
  const errId = useId();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = url.trim();
    if (!v || !isHttpUrl(v)) { setError(LINK_ERROR); return; }
    onSave(v);
    onClose();
  }

  return (
    <Sheet open title="Paste image link" onClose={onClose}
      footer={<Button type="submit" form="paste-image-form" variant="primary" className="btn--block">Save</Button>}>
      <form id="paste-image-form" className="add-form" onSubmit={submit} noValidate>
        <p className="field-hint">A link to a cover image for {title}.</p>
        <div className="field">
          <label className="field-label" htmlFor={id}>Image link</label>
          <input
            id={id} className="input" inputMode="url" autoComplete="off" placeholder="https://" value={url}
            aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
            onChange={(e) => { setUrl(e.target.value); setError(''); }}
          />
          {error && <span id={errId} role="alert" className="field-error">{error}</span>}
        </div>
      </form>
    </Sheet>
  );
}
