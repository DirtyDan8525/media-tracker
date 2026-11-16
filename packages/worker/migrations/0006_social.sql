-- Phase 4 (social). See docs/plans/2026-11-16-phase4-social.md (S3–S9).
ALTER TABLE users ADD COLUMN invite_code TEXT;
ALTER TABLE users ADD COLUMN feed_seen_at TEXT;
-- Set when the admin takes the email off the Access policy; cleared when approved again. Data stays.
ALTER TABLE users ADD COLUMN access_removed_at TEXT;
CREATE UNIQUE INDEX idx_users_invite ON users(invite_code);

-- S5: a post's id is its anchor row's id; later rows within 10 minutes point at the anchor.
ALTER TABLE activity ADD COLUMN post_id TEXT;
CREATE INDEX idx_activity_entry ON activity(user_id, entry_id, created_at);
CREATE INDEX idx_activity_post ON activity(post_id);

-- S3: one row per pair, user_a < user_b.
CREATE TABLE friendships (
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX idx_friendships_b ON friendships(user_b);

-- S7: a reaction or comment targets exactly one of a post (activity anchor id) or an entry.
CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  activity_id TEXT REFERENCES activity(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((activity_id IS NULL) <> (entry_id IS NULL))
);
CREATE UNIQUE INDEX idx_reactions_post ON reactions(activity_id, user_id, emoji) WHERE activity_id IS NOT NULL;
CREATE UNIQUE INDEX idx_reactions_entry ON reactions(entry_id, user_id, emoji) WHERE entry_id IS NOT NULL;

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  activity_id TEXT REFERENCES activity(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK ((activity_id IS NULL) <> (entry_id IS NULL))
);
CREATE INDEX idx_comments_post ON comments(activity_id, created_at);
CREATE INDEX idx_comments_entry ON comments(entry_id, created_at);

-- S2: emails Dan approved, so Admin can list approved-but-not-joined people.
CREATE TABLE invites (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
