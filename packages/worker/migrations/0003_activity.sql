CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_activity_user_created ON activity(user_id, created_at DESC, id DESC);

-- B14: one 'added' row per existing entry that was not imported, so Activity is not empty on day one.
INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at)
SELECT lower(hex(randomblob(16))), user_id, id, 'added', '{}', created_at, created_at
FROM entries WHERE import_id IS NULL;
