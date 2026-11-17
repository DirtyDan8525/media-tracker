-- Phase 6c: admin powers (docs/plans/2026-11-17-phase6c-admin.md, AD1). One row per setting key
-- (features, announcement, whatsNew, comingSoon, about, brand, defaults, lists); a missing row means
-- the built-in default. Validated by PUT /api/admin/app/:key.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
