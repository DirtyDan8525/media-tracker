CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE COLLATE NOCASE,
  display_name TEXT,
  settings_json TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

-- seasonAvg is computed at read time and never stored.
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  typed_title TEXT NOT NULL DEFAULT '',
  status TEXT,
  rating REAL,
  genres TEXT NOT NULL DEFAULT '',
  creator TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  release_date TEXT NOT NULL DEFAULT '',
  synopsis TEXT NOT NULL DEFAULT '',
  length_label TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  details_state TEXT NOT NULL DEFAULT 'none',
  is_private INTEGER NOT NULL DEFAULT 0,
  notes_private INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  source_id TEXT,
  lookup_state TEXT NOT NULL DEFAULT 'pending',
  import_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  rating REAL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE lookup_cache (
  source TEXT NOT NULL,
  query_key TEXT NOT NULL,
  result_json TEXT,
  fetched_at TEXT,
  PRIMARY KEY (source, query_key)
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT,
  counts_json TEXT
);

CREATE INDEX idx_entries_user_category ON entries(user_id, category);
CREATE INDEX idx_seasons_entry ON seasons(entry_id);
