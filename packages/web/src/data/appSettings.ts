import { APP_SETTING_DEFAULTS, publicAppSettings, type FeatureKey, type PublicAppSettings } from '@media-tracker/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { setDeviceDefaults } from './deviceDefaults';
import { api } from '../api/client';

export const APP_KEY = ['app'] as const;

/** What the app uses until the settings arrive, and whenever they can't be read: the built-in defaults. */
export const DEFAULT_APP_SETTINGS: PublicAppSettings = publicAppSettings(APP_SETTING_DEFAULTS);

/** A server answer over the defaults, so a missing key never breaks a screen. */
export function normalizeApp(raw: Partial<PublicAppSettings> | undefined): PublicAppSettings {
  if (!raw) return DEFAULT_APP_SETTINGS;
  const d = DEFAULT_APP_SETTINGS;
  return {
    features: { ...d.features, ...raw.features },
    announcement: raw.announcement ?? null,
    whatsNew: raw.whatsNew ?? null,
    comingSoon: raw.comingSoon ?? null,
    about: raw.about ?? null,
    brand: { ...d.brand, ...raw.brand },
    lists: { ...d.lists, ...raw.lists },
    device: { ...d.device, ...raw.device },
  };
}

/**
 * GET /api/app (AD1): the admin-edited settings, for everyone and also before sign-in. Cached; any failure
 * (offline, an old server) leaves the built-in defaults in place.
 */
export function useAppSettings(): PublicAppSettings {
  const q = useQuery({ queryKey: APP_KEY, queryFn: () => api.get<PublicAppSettings>('/api/app'), staleTime: 60_000, retry: false });
  const app = useMemo(() => normalizeApp(q.data), [q.data]);
  const device = q.data ? app.device : null;
  useEffect(() => { if (device) setDeviceDefaults(device); }, [device]);
  return app;
}

/** Is this feature switched on? (true while the settings are unknown.) */
export function useFeature(key: FeatureKey): boolean {
  return useAppSettings().features[key];
}

/** The app's name: the admin's choice, else "Media Tracker". */
export function useAppName(): string {
  return useAppSettings().brand.name;
}
