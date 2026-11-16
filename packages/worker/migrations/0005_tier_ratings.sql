-- Phase 3c tier ratings (spec v1.2 §4, Rulings Q5 and Q10). Adds columns and one table only:
-- the backfill of tier/prior_mean/strength for already-rated rows is lazy, in the Worker
-- (ensureTiers on GET /api/me), and never rewrites `rating`. Independent of 0003/0004.
ALTER TABLE entries ADD COLUMN tier INTEGER;
ALTER TABLE entries ADD COLUMN prior_mean REAL;
ALTER TABLE entries ADD COLUMN strength REAL;
ALTER TABLE entries ADD COLUMN score_locked INTEGER NOT NULL DEFAULT 0;
-- Bumped by every model write of the rating fields: the optimistic guard that keeps a save and a
-- PATCH racing on the same set from losing either (a stale write fails and answers 409).
ALTER TABLE entries ADD COLUMN rating_rev INTEGER NOT NULL DEFAULT 0;

ALTER TABLE seasons ADD COLUMN tier INTEGER;
ALTER TABLE seasons ADD COLUMN prior_mean REAL;
ALTER TABLE seasons ADD COLUMN strength REAL;
ALTER TABLE seasons ADD COLUMN score_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seasons ADD COLUMN rating_rev INTEGER NOT NULL DEFAULT 0;

-- Picks. Never shown to anyone but their owner. category is a RatingSet (a list, or
-- anime_seasons / tv_seasons). winner_id/loser_id name entries or seasons; Back sets undone_at.
CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  winner_id TEXT NOT NULL,
  loser_id TEXT NOT NULL,
  is_tie INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  undone_at TEXT
);
CREATE INDEX idx_comparisons_user_category ON comparisons(user_id, category);
