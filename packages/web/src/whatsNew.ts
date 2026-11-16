/**
 * The "What's new" and "Coming soon" lists in More. Each release adds an entry at the top of
 * WHATS_NEW and moves what it ships out of COMING_SOON. Plain text, one short line per item.
 */
export interface Release {
  version: string;
  /** ISO date (YYYY-MM-DD) the release went out. */
  date: string;
  items: string[];
}

export const WHATS_NEW: Release[] = [
  {
    version: 'Phase 5',
    date: '2026-11-16',
    items: [
      'A Home tab that opens the last list you used',
      'Switch lists from the title at the top',
      'An Add bubble that asks which list to add to',
      'A short walkthrough for new users',
      'Help to install Media Tracker as an app',
      'A richer Activity feed with profile pictures',
      'React with any emoji',
      'Wider pages on PC',
    ],
  },
  {
    version: 'Phase 4',
    date: '2026-11-08',
    items: [
      'Friends: add people and see their lists',
      'An Activity feed of what friends rate',
      'Reactions and comments on posts',
      'Compare your ratings with a friend',
      'Your own sign-in, with approval for new accounts',
    ],
  },
];

export const COMING_SOON: string[] = [
  'Messages with friends',
  'Notifications',
];
