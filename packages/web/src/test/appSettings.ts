import { APP_SETTING_DEFAULTS, publicAppSettings, type Announcement, type Brand, type Features, type ListsSetting, type PublicAppSettings } from '@media-tracker/shared';

/** The body of GET /api/app with some parts changed (everything else is the built-in default). */
export function publicSettings(over: Partial<Omit<PublicAppSettings, 'features' | 'brand' | 'lists' | 'announcement'>> & {
  features?: Partial<Features>; brand?: Partial<Brand>; lists?: Partial<ListsSetting>; announcement?: Partial<Announcement> | null;
} = {}): PublicAppSettings {
  const d = publicAppSettings(APP_SETTING_DEFAULTS);
  return {
    ...d,
    ...over,
    features: { ...d.features, ...over.features },
    brand: { ...d.brand, ...over.brand },
    lists: { ...d.lists, ...over.lists },
    announcement: over.announcement === null || over.announcement === undefined ? null : { id: 'a1', text: 'Hello', link: null, endsAt: null, ...over.announcement },
  };
}
