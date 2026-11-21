-- Reactions and comments belong to the title (Dan, 2026-11-20): a reaction or comment on an Activity post IS one on that
-- post's title, and shows on the title page (yours and friends' views) and on every post about that title, and the other
-- way round. Until now each row targeted either a post (activity_id) or an entry (entry_id). Apply before deploying the
-- app that reads entry_id only.
--
-- Both tables are rebuilt without activity_id (SQLite cannot drop a column that has a foreign key or a CHECK on it):
--  - a post's rows move to the post's title (the anchor's entry_id),
--  - rows whose post or title is gone are dropped (the cascade normally removed them already), and so are rows of a
--    user who is gone,
--  - reactions stay one per person per emoji per title (the API's rule: you may leave several different emoji). When the
--    move makes two of the same (the same person left the same emoji on the title and on a post of it, or on two posts of
--    it), the newest is kept. Comments are many: all of them move.
-- Nothing references reactions or comments, so dropping the old tables cascades into nothing.
PRAGMA defer_foreign_keys = true;

CREATE TABLE reactions_new (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO reactions_new (id, entry_id, user_id, emoji, created_at)
  SELECT id, entry_id, user_id, emoji, created_at FROM (
    SELECT r.id, COALESCE(r.entry_id, a.entry_id) AS entry_id, r.user_id, r.emoji, r.created_at,
           ROW_NUMBER() OVER (PARTITION BY COALESCE(r.entry_id, a.entry_id), r.user_id, r.emoji ORDER BY r.created_at DESC, r.id DESC) AS rn
      FROM reactions r LEFT JOIN activity a ON a.id = r.activity_id
  )
  WHERE rn = 1 AND entry_id IN (SELECT id FROM entries) AND user_id IN (SELECT id FROM users);
DROP TABLE reactions;
ALTER TABLE reactions_new RENAME TO reactions;
-- One per person per emoji per title, and also the lookup of a title's reactions (feed summaries, the title page, who reacted).
CREATE UNIQUE INDEX idx_reactions_entry ON reactions(entry_id, user_id, emoji);
-- Unread count: reactions newer than feed_seen_at (as in 0019).
CREATE INDEX idx_reactions_created ON reactions(created_at);

CREATE TABLE comments_new (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
INSERT INTO comments_new (id, entry_id, user_id, body, created_at, deleted_at)
  SELECT k.id, COALESCE(k.entry_id, a.entry_id), k.user_id, k.body, k.created_at, k.deleted_at
    FROM comments k LEFT JOIN activity a ON a.id = k.activity_id
   WHERE COALESCE(k.entry_id, a.entry_id) IN (SELECT id FROM entries) AND k.user_id IN (SELECT id FROM users);
DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;
-- A title's thread, oldest first, and the feed's comment counts.
CREATE INDEX idx_comments_entry ON comments(entry_id, created_at);
-- Unread count: comments newer than feed_seen_at (as in 0019).
CREATE INDEX idx_comments_created ON comments(created_at);
