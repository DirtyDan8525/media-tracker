import type { UserSettings } from '@media-tracker/shared';

/** GET /api/me */
export interface Me {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  settings: UserSettings;
  avatarAt: string | null;
  displayName: string | null;
  createdAt: string | null;
  /** Phase 4b (A6): 'pending' until Dan approves; a removed user never gets a /api/me answer. */
  status: 'pending' | 'active' | 'removed';
}
