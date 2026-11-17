-- Phase 5: episode progress (item 22).
-- progress: episodes watched / chapters read so far (>= 0, checked by the API). NULL = never counted.
-- progress_total: the episode or chapter total when known (from a lookup or typed); NULL = unknown.
-- Existing rows keep NULL in both, so nothing changes for titles already stored.
ALTER TABLE entries ADD COLUMN progress INTEGER;
ALTER TABLE entries ADD COLUMN progress_total INTEGER;
