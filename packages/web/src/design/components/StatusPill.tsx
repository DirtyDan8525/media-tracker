import { statusColor, type CfSet, type Status } from '@media-tracker/shared';
import { useCfSet } from '../ThemeContext';

export function StatusPill({ status, cf }: { status: Status; cf?: CfSet }) {
  const ctxCf = useCfSet();
  const bg = statusColor(status, cf ?? ctxCf);
  return <span className="status-pill" style={{ background: bg ?? 'var(--panel)' }}>{status}</span>;
}
