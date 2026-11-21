-- Pictures and GIFs in comments (2026-11-20): a comment may carry one photo or GIF, stored in R2 (binding MEDIA) like chat pictures
-- and counted in the same `media` ledger (storage per person, the daily clean-up, Delete account).
--  - comments.media_key: the file's key (NULL: none, or removed). comments.media_expired is 1 once the clean-up removed the
--    file, so the thread reads "Picture expired" (the comment stays).
--  - media: a comment's file has no chat or message, so conversation_id and message_id become nullable and the row gains
--    comment_id and entry_id. A file is uploaded first (comment_id NULL, "pending") and joins its comment when that is posted;
--    pending files older than an hour are cleaned up. SQLite cannot drop NOT NULL, so the table is rebuilt (rows and indexes kept).
-- Apply before deploying the app that reads these columns.
ALTER TABLE comments ADD COLUMN media_key TEXT;
ALTER TABLE comments ADD COLUMN media_expired INTEGER NOT NULL DEFAULT 0;

CREATE TABLE media_new (
  key TEXT PRIMARY KEY,
  conversation_id TEXT,
  message_id TEXT,
  comment_id TEXT,
  entry_id TEXT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'voice')),
  bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
INSERT INTO media_new (key, conversation_id, message_id, user_id, kind, bytes, duration_ms, created_at, deleted_at)
  SELECT key, conversation_id, message_id, user_id, kind, bytes, duration_ms, created_at, deleted_at FROM media;
DROP TABLE media;
ALTER TABLE media_new RENAME TO media;
CREATE INDEX idx_media_live_created ON media(created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_user_live ON media(user_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_message ON media(message_id);
CREATE INDEX idx_media_comment ON media(comment_id);
