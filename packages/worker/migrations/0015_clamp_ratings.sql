-- Two 10s compared could be nudged above 10 (fixed in shared/ratings/close.ts, 2026-11-19).
-- Pull any stored score back into 0–10; the next save in that list re-fits the order properly.
UPDATE entries SET rating = 10 WHERE rating > 10;
UPDATE entries SET rating = 0 WHERE rating < 0;
UPDATE seasons SET rating = 10 WHERE rating > 10;
UPDATE seasons SET rating = 0 WHERE rating < 0;
