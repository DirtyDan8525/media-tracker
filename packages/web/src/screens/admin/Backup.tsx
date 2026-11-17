import { useState } from 'react';
import { downloadBackup } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { PlainPage, Result, useFeedback } from './parts';

/** /admin/backup (AD10): a JSON copy of everything except the secrets, saved through a hidden download link. */
export function BackupScreen() {
  const [busy, setBusy] = useState(false);
  const fb = useFeedback();
  async function run() {
    setBusy(true);
    try {
      const name = await downloadBackup();
      fb.ok(`Backup downloaded: ${name}`);
    } catch {
      fb.fail("Couldn't download the backup. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <PlainPage title="Backup">
      <section aria-labelledby="bk-title" className="group">
        <h2 id="bk-title" className="group__title">Backup</h2>
        <div className="admin-card">
          <Button variant="primary" disabled={busy} onClick={() => void run()}>{busy ? 'Preparing backup…' : 'Download a backup'}</Button>
          <span className="hint">Passwords and sign-in tokens are left out.</span>
          <Result fb={fb.fb} />
          <details className="admin-details">
            <summary>How to restore</summary>
            <p className="hint">
              This file is for keeping and reading. To restore the whole database, use Wrangler: <code>wrangler d1 export</code> makes a full SQL
              backup and <code>wrangler d1 execute --file</code> loads one back. The steps are in SETUP, under "Backing up and restoring".
            </p>
          </details>
        </div>
      </section>
    </PlainPage>
  );
}
