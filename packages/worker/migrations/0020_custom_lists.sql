-- Phase 7: custom lists (wireframe docs/design/mockups/Phase7.wf.html section 3). A person's own lists ("Restaurants"),
-- at most 6 each (the API checks). A list's titles are ordinary entries rows whose category is 'c_' || custom_lists.id;
-- deleting a list deletes them in the same batch (the API), and deleting the person deletes everything (cascade).
CREATE TABLE custom_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- One item is a… ("restaurant" -> "Add restaurant").
  noun TEXT NOT NULL,
  -- One emoji, or NULL.
  icon TEXT,
  -- The second line's name ("Cuisine"); NULL = no second line.
  creator_label TEXT,
  has_status INTEGER NOT NULL DEFAULT 1,
  -- 'watch' | 'read' | 'play' | 'try': labels only; stored statuses are the usual ones.
  status_words TEXT NOT NULL DEFAULT 'watch',
  show_tags INTEGER NOT NULL DEFAULT 1,
  show_year INTEGER NOT NULL DEFAULT 0,
  show_genres INTEGER NOT NULL DEFAULT 0,
  show_progress INTEGER NOT NULL DEFAULT 0,
  show_link INTEGER NOT NULL DEFAULT 0,
  -- NULL = type it in; else 'movies' | 'tv' | 'books' | 'games' | 'music'.
  search_source TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_custom_lists_user ON custom_lists(user_id, created_at);

-- A web or map link per title (custom lists with a Link column). Existing titles start with none.
ALTER TABLE entries ADD COLUMN link TEXT NOT NULL DEFAULT '';
