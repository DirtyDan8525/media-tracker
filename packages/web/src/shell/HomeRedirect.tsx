import { Navigate } from 'react-router';
import { homePath } from '../nav';
import { useSessionMe } from './SessionGate';

export function HomeRedirect() {
  return <Navigate to={homePath(useSessionMe().settings)} replace />;
}
