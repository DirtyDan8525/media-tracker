-- Phase 5: Plan to watch order (item 15) and profile bio (item 17).
-- plan_order: the title's place in its list's Plan to watch order (1 = up next). NULL when it is not
-- planned. Titles that are planned already get 1, 2, 3... in the order they were added.
ALTER TABLE entries ADD COLUMN plan_order REAL;
UPDATE entries SET plan_order = (
  SELECT COUNT(*) FROM entries b
  WHERE b.user_id = entries.user_id AND b.category = entries.category AND b.status = 'Plan to watch'
    AND (b.created_at < entries.created_at OR (b.created_at = entries.created_at AND b.rowid <= entries.rowid))
) WHERE status = 'Plan to watch';

-- bio: up to 150 characters, plain text (checked by the API, not here).
ALTER TABLE users ADD COLUMN bio TEXT;
