import { statusColor, type Category, type CfSet, type Status } from '@media-tracker/shared';
import { useCfSet } from '../ThemeContext';
import { statusText } from '../../lists/registry';

export function StatusPill({ status, category, cf }: { status: Status; category: Category; cf?: CfSet }) {
  const ctxCf = useCfSet();
  const bg = statusColor(status, cf ?? ctxCf);
  return <span className="status-pill" style={{ background: bg ?? 'var(--panel)' }}>{statusText(status, category)}</span>;
}
