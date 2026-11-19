-- Movies get a Status column (Dan, 2026-11-19: Plan to watch for movies). Movies already on a list were watched.
UPDATE entries SET status = 'Completed' WHERE category = 'movies' AND status IS NULL;
