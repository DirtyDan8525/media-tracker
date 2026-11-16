-- Phase 4 (social) and 4b (own sign-in). See docs/plans/2026-11-16-phase4-social.md (S3–S9)
-- and docs/plans/2026-11-16-phase4b-own-signin.md (A1–A8).
ALTER TABLE users ADD COLUMN invite_code TEXT;
ALTER TABLE users ADD COLUMN feed_seen_at TEXT;
CREATE UNIQUE INDEX idx_users_invite ON users(invite_code);

-- A1/A2/A6: password sign-in with approval. Rows from before (Dan) stay 'active' and have no
-- password until `npm run set-password` gives them one. Password-only users get email 'u:<id>'.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'removed'));

-- A3: only the SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- A5: failed sign-ins per (lowercased) username, existing or not.
CREATE TABLE login_failures (
  username TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX idx_login_failures ON login_failures(username, at);

-- A7: one-time reset links (24 h), stored hashed.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);

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
