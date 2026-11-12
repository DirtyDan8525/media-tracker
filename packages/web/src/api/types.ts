import type { UserSettings } from '@media-tracker/shared';

/** GET /api/me */
export interface Me {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  settings: UserSettings;
}
