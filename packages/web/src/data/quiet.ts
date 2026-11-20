import { isQuiet, quietUntilFrom } from '@media-tracker/shared';
import { useEffect, useState } from 'react';
import { useSaveSettings, SETTINGS_SAVE_ERROR } from './useMe';

/** setTimeout cannot wait longer than this (a signed 32-bit number of ms). */
const MAX_TIMER = 2 ** 31 - 1;

/**
 * Quiet mode as the screen shows it: `on` is true while `quietUntil` is ahead. It flips to false by itself at the
 * expiry time, with no reload, so the banner and the switch go away when the 24 hours end.
 */
export function useQuiet(quietUntil: string | null | undefined): { on: boolean; until: Date | null } {
  const [, tick] = useState(0);
  const on = isQuiet(quietUntil);
  useEffect(() => {
    if (!on || typeof quietUntil !== 'string') return;
    const wait = Date.parse(quietUntil) - Date.now();
    const id = setTimeout(() => tick((n) => n + 1), Math.min(Math.max(wait, 0) + 50, MAX_TIMER));
    return () => clearTimeout(id);
  }, [on, quietUntil]);
  return { on, until: on && typeof quietUntil === 'string' ? new Date(quietUntil) : null };
}

/** Turns quiet mode on (now + 24 h) or off (clears it). */
export function useSetQuiet() {
  const save = useSaveSettings({ errorToast: SETTINGS_SAVE_ERROR });
  return (on: boolean) => save.mutate({ quietUntil: on ? quietUntilFrom() : null });
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "3:40 PM today", "3:40 PM tomorrow", or the weekday when it is further off (never, for 24 hours; kept for odd clocks). */
export function formatQuietUntil(until: Date, now: Date = new Date()): string {
  const time = until.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/[  ]/g, ' ');
  const days = Math.round((startOfDay(until) - startOfDay(now)) / 86_400_000);
  const day = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : until.toLocaleDateString('en-US', { weekday: 'long' });
  return `${time} ${day}`;
}
