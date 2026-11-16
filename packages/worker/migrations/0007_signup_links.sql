-- Pre-approved sign-up links (Phase 4b follow-up). Dan makes a link; whoever signs up with it is
-- active at once. Single use, and unused links expire after 7 days. Only the SHA-256 of the token
-- is stored (like sessions), so a leaked database cannot be used to sign up.
CREATE TABLE signup_links (
  token_hash TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,                 -- random, for listing and revoking (never the token)
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_signup_links_created ON signup_links(created_at);
