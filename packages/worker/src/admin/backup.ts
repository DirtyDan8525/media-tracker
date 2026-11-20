/**
 * What "Download a backup" (AD10) contains. The JSON is for reading and keeping; the full SQL
 * backup is `wrangler d1 export` (docs/SETUP.md, "Backing up and restoring").
 *
 * EXCLUDED, exactly this and nothing else:
 *  - whole tables sessions and password_resets (they hold only sign-in token hashes);
 *  - users.password_hash and users.public_token_hash (the public profile link's hash; public_link_at stays);
 *  - signup_links.token_hash (the link's id, dates and who used it stay);
 *  - push_subscriptions.endpoint, p256dh and auth (the push address and its keys; user and dates stay);
 *  - avatars.data (the picture bytes, which JSON cannot carry well; the avatar's owner and date stay).
 * Every other table is included whole. test/admin.test.ts fails when a table exists that is in neither list, so a
 * new table has to be decided here.
 */
export const BACKUP_SKIPPED_TABLES: readonly string[] = ['sessions', 'password_resets'];

/** Included tables, with the columns left out of each. */
export const BACKUP_TABLES: Readonly<Record<string, readonly string[]>> = {
  users: ['password_hash', 'public_token_hash'],
  entries: [],
  seasons: [],
  comparisons: [],
  compare_queue: [],
  imports: [],
  lookup_cache: [],
  avatars: ['data'],
  activity: [],
  friendships: [],
  reactions: [],
  comments: [],
  login_failures: [],
  signup_links: ['token_hash'],
  conversations: [],
  conversation_members: [],
  messages: [],
  push_subscriptions: ['endpoint', 'p256dh', 'auth'],
  push_throttle: [],
  app_settings: [],
  tags: [],
  entry_tags: [],
  custom_lists: [],
  message_reactions: [],
  /** The photo / voice memo ledger (keys, sizes, dates); the files themselves are in R2 and not in any backup. */
  media: [],
};

/** The same for the response's `excluded` note, so the file says what it leaves out. */
export const BACKUP_EXCLUDED_NOTE = {
  tables: BACKUP_SKIPPED_TABLES,
  columns: Object.fromEntries(Object.entries(BACKUP_TABLES).filter(([, cols]) => cols.length > 0)),
};
