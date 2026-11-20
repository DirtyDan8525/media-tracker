import { useCallback, useState } from 'react';
import { useDeviceDefaults } from '../../data/deviceDefaults';

/** Text sizes as a share of the normal text (Dan, 2026-11-19): 5 steps, saved on this device only. */
export const TEXT_STEPS = [85, 100, 115, 125, 140] as const;
export const DEFAULT_STEP = 1;

/** The step this device saved, or -1 when it has not saved one (then the admin's starting size applies). */
function load(key: string): number {
  try {
    const v = Number(window.localStorage.getItem(key));
    return TEXT_STEPS.indexOf(v as (typeof TEXT_STEPS)[number]);
  } catch {
    return -1;
  }
}

/** A text-size step (an index into TEXT_STEPS) saved under localStorage `key`; storage that fails is ignored. */
export function useTextSize(key: string): { step: number; percent: number; scale: number; set: (i: number) => void } {
  const [saved, setStep] = useState(() => load(key));
  const d = useDeviceDefaults();
  const start = TEXT_STEPS.indexOf((key === 'chat-text-size' ? d.chatTextSize : d.activityTextSize) as (typeof TEXT_STEPS)[number]);
  const step = saved >= 0 ? saved : start >= 0 ? start : DEFAULT_STEP;
  const set = useCallback((i: number) => {
    const next = Math.min(TEXT_STEPS.length - 1, Math.max(0, i));
    setStep(next);
    try {
      window.localStorage.setItem(key, String(TEXT_STEPS[next]));
    } catch {
      /* private mode or full: the size still applies until the page closes */
    }
  }, [key]);
  return { step, percent: TEXT_STEPS[step]!, scale: TEXT_STEPS[step]! / 100, set };
}

/** The chat's text size. */
export const useChatTextSize = () => useTextSize('chat-text-size');
/** The Activity feed's text size. */
export const useActivityTextSize = () => useTextSize('activity-text-size');
