import { EmptyState } from '../design/components/EmptyState';
import { PageHeader } from '../shell/PageHeader';

/** Stand-in for the import flow (Task 14). */
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
