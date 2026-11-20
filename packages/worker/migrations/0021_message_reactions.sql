-- Phase 6 follow-up (2026-11-20): message reactions, recent custom emoji per person, and voice memos as a message kind.
-- Apply before deploying the app that reads them.
PRAGMA defer_foreign_keys = true;

-- 1. messages gains the kind 'voice' (a voice memo; its file key is in image_key, like a picture's). SQLite cannot change a
--    CHECK, so the table is rebuilt with the same columns and indexes. Nothing else references messages yet (message_reactions
--    is created below, after the rebuild), and the new table's own reply_to points at messages_new, which the rename turns
--    into messages: dropping the old table cascades into nothing that is kept.
CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'rec', 'voice')),
  body TEXT NOT NULL DEFAULT '',
  rec_json TEXT,
  image_key TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  reply_to TEXT REFERENCES messages_new(id) ON DELETE SET NULL
);
INSERT INTO messages_new (id, conversation_id, sender_id, kind, body, rec_json, image_key, created_at, deleted_at, reply_to)
  SELECT id, conversation_id, sender_id, kind, body, rec_json, image_key, created_at, deleted_at, reply_to FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX idx_messages_sender ON messages(sender_id, created_at);
CREATE INDEX idx_messages_reply_to ON messages(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX idx_messages_conv_created_id ON messages(conversation_id, created_at, id);
CREATE INDEX idx_messages_rec ON messages(conversation_id, created_at) WHERE kind = 'rec';
CREATE INDEX idx_messages_deleted ON messages(conversation_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- 2. Chat message reactions: one emoji per person per message (tapping the same one removes it, a different one replaces it).
-- The primary key (message_id, user_id) is also the lookup by message_id (a page's reactions are read in one query).
-- conversation_id is kept here too (the chat's reactions as one index range; the cascade when a chat is deleted).
CREATE TABLE message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX idx_message_reactions_conv ON message_reactions(conversation_id, created_at);
-- Bumped by every reaction change in the chat: the open-chat poll's fingerprint reads this one number instead of counting reactions.
ALTER TABLE conversations ADD COLUMN reaction_rev INTEGER NOT NULL DEFAULT 0;

-- 3. A person's 4 most recently used custom reaction emoji (not in the quick set), newest first: JSON array text, NULL = none.
-- Read with the sign-in row (no extra query) and written in the same request as the reaction.
ALTER TABLE users ADD COLUMN recent_emoji TEXT;
