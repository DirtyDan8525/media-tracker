-- Phase 5 item 34: a public profile link (/p/<token>). Off by default (NULL). Only the SHA-256 of the
-- 128-bit random token is stored, like sessions and sign-up links, so a leaked database cannot open
-- anyone's page. SQLite cannot add a UNIQUE column, so the uniqueness is a unique index (NULLs repeat freely).
ALTER TABLE users ADD COLUMN public_token_hash TEXT;
ALTER TABLE users ADD COLUMN public_link_at TEXT;
CREATE UNIQUE INDEX idx_users_public_token ON users(public_token_hash);
