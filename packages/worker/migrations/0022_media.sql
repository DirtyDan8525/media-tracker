-- Photos and voice memos in chats (2026-11-20): a ledger of every file in the R2 bucket (binding MEDIA), so storage per person
-- can be counted and old files cleaned up (the daily scheduled run: older than the admin's months, and each person's cap).
-- No foreign keys on purpose: a row outlives its message, chat or sender (all cascade away), so the daily run can still find
-- the file and delete it from R2. deleted_at is set when the file is removed; such rows are purged after 30 days.
CREATE TABLE media (
  key TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'voice')),
  bytes INTEGER NOT NULL,
  -- Voice memos: the length the sender's phone measured (at most 120 000); NULL for photos.
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
-- Live files, oldest first: the age sweep and the storage total.
CREATE INDEX idx_media_live_created ON media(created_at) WHERE deleted_at IS NULL;
-- One person's live files, oldest first: their total and the cap.
CREATE INDEX idx_media_user_live ON media(user_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_message ON media(message_id);

-- Pictures sent before this (development only: production had no bucket) join the ledger with an unknown size.
INSERT OR IGNORE INTO media (key, conversation_id, message_id, user_id, kind, bytes, created_at)
  SELECT image_key, conversation_id, id, sender_id, 'photo', 0, created_at FROM messages WHERE image_key IS NOT NULL AND kind = 'image';
