import { useQuiet, useSetQuiet } from '../data/quiet';
import { useSessionMe } from './SessionGate';
import '../design/quiet.css';

/**
 * One line at the top of the app (phone and PC) while quiet mode is on. It has no close button: the only way
 * to hide it is "Turn off", which turns quiet mode off.
 */
export function QuietBanner() {
  const me = useSessionMe();
  const { on } = useQuiet(me.settings.quietUntil);
  const setQuiet = useSetQuiet();
  if (!on) return null;
  return (
    <div className="quiet-banner" role="status">
      <span className="quiet-banner__text">Quiet mode is on: your changes aren't posted.</span>
      <button type="button" className="quiet-banner__off" onClick={() => setQuiet(false)}>Turn off</button>
    </div>
  );
}
