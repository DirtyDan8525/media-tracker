-- Notifications (messages only, 2026-11-20): a member can mute a chat. 1 = no push for new messages in it.
-- Apply before deploying the app that reads it.
ALTER TABLE conversation_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
