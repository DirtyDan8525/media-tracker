-- Phase 7: custom tags (per person) and the optional "More stats" columns.
-- tags: one row per label a person made; names are unique per person, ignoring case.
-- entry_tags: which tag sits on which title. Both sides cascade, so deleting a title or a tag cleans up.
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_tags_user_name ON tags(user_id, lower(name));

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);

-- started_at / finished_at: 'YYYY-MM-DD' or NULL (unset). rewatches: how many times again (>= 0).
-- Existing rows keep NULL / 0, so nothing changes for titles already stored.
ALTER TABLE entries ADD COLUMN started_at TEXT;
ALTER TABLE entries ADD COLUMN finished_at TEXT;
ALTER TABLE entries ADD COLUMN rewatches INTEGER NOT NULL DEFAULT 0;
