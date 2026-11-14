import { useId, useState } from 'react';
import { api } from '../../api/client';
import { Icon } from '../../design/components/Icon';
import { useToast } from '../../design/components/Toast';

/** media-tracker-export-YYYY-MM-DD.json, in the device's local date. */
export function exportFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `media-tracker-export-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the download after click() returns; give them a moment before freeing the Blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Settings → Your data → "Export my data" (SettingsMore.v2): GET /api/export saved as a dated .json file. */
export function ExportRow() {
  const toast = useToast();
  const hintId = useId();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const data = await api.get<unknown>('/api/export');
      download(JSON.stringify(data, null, 2), exportFileName());
    } catch {
      toast.show("Couldn't export your data. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="group__row export-row" disabled={busy} aria-describedby={hintId} onClick={() => void run()}>
      <span className="group__row-start">
        <span className="tile-icon"><Icon name="download" size={18} /></span>
        {busy ? 'Exporting…' : 'Export my data'}
      </span>
      <span id={hintId} className="group__value" aria-hidden="true">.json file</span>
    </button>
  );
}
