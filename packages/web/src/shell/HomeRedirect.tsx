import { Navigate } from 'react-router';
import { useCurrentList } from './currentList';

/** Home (`/`): the list last shown (default: the first enabled list, Anime); Settings when every list is off. */
export function HomeRedirect() {
  const current = useCurrentList();
  return <Navigate to={current ? `/list/${current}` : '/settings'} replace />;
}
