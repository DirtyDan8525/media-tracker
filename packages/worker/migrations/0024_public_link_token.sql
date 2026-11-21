-- Dan 2026-11-20: the public profile link can be shared any time, so the raw token is now kept (next to the
-- hash, which stays the lookup key: /api/public/:token is unchanged). NULL = no stored token: either the link
-- is off, or it was made before this migration (the owner is offered "Make a new link to share"; the old one
-- keeps working until replaced). Turning the link off clears both columns.
ALTER TABLE users ADD COLUMN public_token TEXT;
