-- Replies in chats: a message may answer another message of the same chat (checked by the API). If the original row is ever hard-deleted
-- (its sender's account removed), the reply stays and its quote reads "Original message deleted".
ALTER TABLE messages ADD COLUMN reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX idx_messages_reply_to ON messages(reply_to) WHERE reply_to IS NOT NULL;
