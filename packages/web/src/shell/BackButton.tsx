import { useNavigate } from 'react-router';
import { IconButton } from '../design/components/IconButton';
import { useIsWide } from '../hooks';

/** Phone-only back arrow (PC always shows the side nav). */
export function BackButton({ to }: { to: string }) {
  const wide = useIsWide();
  const navigate = useNavigate();
  if (wide) return null;
  return <IconButton label="Back" icon="back" look="plain" className="back-btn" onClick={() => navigate(to)} />;
}
