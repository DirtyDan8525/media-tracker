import { THEMES, type UserSettings } from '@media-tracker/shared';
import { useMemo, useSyncExternalStore } from 'react';

/**
 * Theme (with Custom colours) and the app's text size are saved on THIS device only (Dan, 2026-11-20: purple phone, amber
 * PC, bigger text on the PC). The account's theme (and the admin default) is just the starting value on a device that has
 * not chosen yet. Storage that fails is ignored: the choice then lasts until the page closes.
 */
export const THEME_KEY = 'mt-theme';
export const TEXT_SCALE_KEY = 'mt-text-scale';

export const TEXT_SCALES = [
  { id: 'smaller', label: 'Smaller', percent: 90 },
  { id: 'default', label: 'Default', percent: 100 },
  { id: 'larger', label: 'Larger', percent: 112 },
  { id: 'largest', label: 'Largest', percent: 125 },
] as const;
export type TextScaleId = (typeof TEXT_SCALES)[number]['id'];

export interface DeviceTheme { theme: string; colors: Record<string, string> }

const HEX = /^#[0-9a-f]{6}$/i;
const validTheme = (t: unknown): t is string => typeof t === 'string' && (t === 'Custom' || t in THEMES);

function readTheme(): DeviceTheme | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const { theme, colors } = raw as { theme?: unknown; colors?: unknown };
    if (!validTheme(theme)) return null;
    const out: Record<string, string> = {};
    if (typeof colors === 'object' && colors !== null) {
      for (const [k, v] of Object.entries(colors)) if (typeof v === 'string' && HEX.test(v)) out[k] = v;
    }
    return { theme, colors: out };
  } catch {
    return null;
  }
}

function readScale(): TextScaleId | null {
  try {
    const v = localStorage.getItem(TEXT_SCALE_KEY);
    return TEXT_SCALES.some((s) => s.id === v) ? (v as TextScaleId) : null;
  } catch {
    return null;
  }
}

interface Look { theme: DeviceTheme | null; scale: TextScaleId | null }
let current: Look | undefined;
const listeners = new Set<() => void>();
const get = (): Look => (current ??= { theme: readTheme(), scale: readScale() });
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export const getDeviceTheme = (): DeviceTheme | null => get().theme;
export const getTextScale = (): TextScaleId | null => get().scale;

/** Saves the theme (and Custom colours) on this device. */
export function setDeviceTheme(t: DeviceTheme): void {
  current = { ...get(), theme: { theme: t.theme, colors: { ...t.colors } } };
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(current.theme));
  } catch {
    // keep it in memory
  }
  emit();
}

/** Saves the app's text size on this device and applies it. */
export function setTextScale(id: TextScaleId): void {
  current = { ...get(), scale: id };
  try {
    localStorage.setItem(TEXT_SCALE_KEY, id);
  } catch {
    // keep it in memory
  }
  applyTextScale(id);
  emit();
}

/** Re-reads storage (tests, and another tab's change). */
export function reloadDeviceLook(): void {
  current = undefined;
  applyTextScale(getTextScale());
  emit();
}

/** Sets `--app-scale` on <html>; every text token in tokens.css multiplies by it. */
export function applyTextScale(id: TextScaleId | null, root: HTMLElement = document.documentElement): void {
  const pct = TEXT_SCALES.find((s) => s.id === id)?.percent ?? 100;
  root.style.setProperty('--app-scale', String(pct / 100));
}

/** The account's settings with this device's theme and colours laid over them (the account value is the fallback). */
export function withDeviceLook<T extends Pick<UserSettings, 'theme' | 'colors'>>(settings: T, dev: DeviceTheme | null = getDeviceTheme()): T {
  if (!dev) return settings;
  return { ...settings, theme: dev.theme, colors: dev.colors };
}

export function useDeviceTheme(): DeviceTheme | null {
  return useSyncExternalStore(subscribe, () => get().theme, () => null);
}

export function useTextScale(): TextScaleId | null {
  return useSyncExternalStore(subscribe, () => get().scale, () => null);
}

/** `settings` as this device sees them. */
export function useDeviceSettings<T extends Pick<UserSettings, 'theme' | 'colors'>>(settings: T): T {
  const dev = useDeviceTheme();
  return useMemo(() => withDeviceLook(settings, dev), [settings, dev]);
}
