-- Phase 6b: web push. One row per browser/device a user turned notifications on for.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_ok_at TEXT
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Reaction throttle (P3): at most one reaction push per post per 10 minutes. key = 'reaction:' || post id.
CREATE TABLE push_throttle (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
