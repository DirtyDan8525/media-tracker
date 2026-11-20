-- D1 rows-read diet (2026-11-20). Indexes only: no table or row changes. Each one replaces a scan or a sort that
-- EXPLAIN QUERY PLAN showed on a hot path (test/rowsRead.test.ts measures them).

-- Chat pages, the chat list's last message and unread dot, the 5 s poll: newest first by (created_at, id) without a
-- sort over the whole chat. Replaces idx_messages_conversation (a prefix of this one).
CREATE INDEX idx_messages_conv_created_id ON messages(conversation_id, created_at, id);
DROP INDEX idx_messages_conversation;
-- Recommendations sent to you: only the rec messages of your chats.
CREATE INDEX idx_messages_rec ON messages(conversation_id, created_at) WHERE kind = 'rec';
-- The open-chat poll's "anything deleted?" check reads only deleted messages (usually none).
CREATE INDEX idx_messages_deleted ON messages(conversation_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- Activity: feed pages walk anchors (post_id IS NULL) newest first and stop after a page; the unread count reads only
-- anchors newer than feed_seen_at. idx_activity_post now holds only the joined rows (post_id = ?, post_id IN (...)
-- still use it), so an anchor search is never estimated as a cheap "post_id IS NULL" lookup over every anchor.
CREATE INDEX idx_activity_anchor_created ON activity(created_at, id) WHERE post_id IS NULL;
DROP INDEX idx_activity_post;
CREATE INDEX idx_activity_post ON activity(post_id) WHERE post_id IS NOT NULL;

-- Unread count: comments and reactions newer than feed_seen_at.
CREATE INDEX idx_comments_created ON comments(created_at);
CREATE INDEX idx_reactions_created ON reactions(created_at);

-- GET /api/me's lazy typed-number backfill check (ensureTyped): rows still waiting for it, usually none.
CREATE INDEX idx_entries_untyped ON entries(user_id) WHERE rating IS NOT NULL AND typed IS NULL;
CREATE INDEX idx_seasons_untyped ON seasons(entry_id) WHERE rating IS NOT NULL AND typed IS NULL;
