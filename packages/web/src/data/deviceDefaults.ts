import { APP_SETTING_DEFAULTS, type DeviceDefaults } from '@media-tracker/shared';
import { useSyncExternalStore } from 'react';

/**
 * Admin Defaults for settings that live only in this browser (side bar width, chat and Activity text size, table column
 * widths). They are just the starting value: anything this device saved itself wins. Filled from GET /api/app, and
 * remembered on the device so the first paint after a reload already has them.
 */
const KEY = 'mt-device-defaults';
export const BUILT_IN_DEVICE: DeviceDefaults = APP_SETTING_DEFAULTS.defaults.device;

function read(): DeviceDefaults {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw === 'object' && raw !== null) return { ...BUILT_IN_DEVICE, ...(raw as Partial<DeviceDefaults>) };
  } catch {
    // none saved
  }
  return BUILT_IN_DEVICE;
}

let current: DeviceDefaults | undefined;
const listeners = new Set<() => void>();
export const getDeviceDefaults = (): DeviceDefaults => (current ??= read());

export function setDeviceDefaults(d: DeviceDefaults): void {
  if (JSON.stringify(d) === JSON.stringify(getDeviceDefaults())) return;
  current = d;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // keep it in memory
  }
  listeners.forEach((l) => l());
}

/** Re-reads storage (tests). */
export function reloadDeviceDefaults(): void {
  current = undefined;
  listeners.forEach((l) => l());
}

export function useDeviceDefaults(): DeviceDefaults {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getDeviceDefaults, () => BUILT_IN_DEVICE);
}
