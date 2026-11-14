import { useLocation, useNavigate } from 'react-router';
import { IconButton } from '../design/components/IconButton';
import { useIsWide } from '../hooks';

/**
 * Phone-only back arrow (PC always shows the side nav). With `useHistory`, it goes back to the previous
 * in-app screen when there is one (React Router's first entry has key 'default'), else to `to`.
 */
export function BackButton({ to, useHistory = false }: { to: string; useHistory?: boolean }) {
  const wide = useIsWide();
  const navigate = useNavigate();
  const { key } = useLocation();
  if (wide) return null;
  const back = () => (useHistory && key !== 'default' ? navigate(-1) : navigate(to));
  return <IconButton label="Back" icon="back" look="plain" className="back-btn" onClick={() => void back()} />;
}
