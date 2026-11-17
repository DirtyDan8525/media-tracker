-- Phase 5 item 14, number-first rating (docs/plans/2026-11-16-phase5-number-first.md, Ruling N1).
-- Adds the typed number only; nothing is dropped. `rating` stays the shown number. Rows rated
-- before this get `typed` lazily in the Worker (ensureTyped on GET /api/me, Ruling N2), because a
-- 3c-fitted row's typed number is read from its prior, which needs exp() (D1's math functions
-- were never verified).
ALTER TABLE entries ADD COLUMN typed REAL;
ALTER TABLE seasons ADD COLUMN typed REAL;
