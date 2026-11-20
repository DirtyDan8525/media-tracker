import type { CustomList, Customized, UserSettings } from '@media-tracker/shared';

/** GET /api/me */
export interface Me {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  settings: UserSettings;
  /** Which settings the person set themselves; the rest follow the admin's defaults (already in `settings`). Absent on copies cached before this. */
  customized?: Customized;
  avatarAt: string | null;
  displayName: string | null;
  /** Phase 5 (item 17): up to 150 characters; null or absent when none (rows cached before Phase 5 lack it). */
  bio?: string | null;
  createdAt: string | null;
  /** Phase 4b (A6): 'pending' until Dan approves; a removed user never gets a /api/me answer. */
  status: 'pending' | 'active' | 'removed';
  /** Phase 7: your custom lists, oldest first. Absent on copies cached before them (normalizeMe fills []). */
  customLists: CustomList[];
  /** Your 4 most recently used custom reaction emoji, newest first (the pickers' "Recent" row). Absent on older copies. */
  recentEmoji?: string[];
}
