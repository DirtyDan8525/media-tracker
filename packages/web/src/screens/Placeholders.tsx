import { EmptyState } from '../design/components/EmptyState';
import { PageHeader } from '../shell/PageHeader';

/** Stand-ins for the routes Task 13 builds (import flow, entry details). */
export function ImportScreen() {
  return (
    <div className="screen">
      <PageHeader title="Import" backTo="/more" />
      <div className="screen__body">
        <EmptyState icon="upload" title="Import isn't ready yet" body="Importing from your Google Sheets arrives in the next update." />
      </div>
    </div>
  );
}

export function EntryScreen() {
  return (
    <div className="screen">
      <PageHeader title="Details" backTo="/" />
      <div className="screen__body">
        <EmptyState icon="info" title="Details aren't ready yet" body="Entry details arrive in the next update." />
      </div>
    </div>
  );
}
