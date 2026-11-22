-- 0087_link_previews.sql (batch L, reader safety): link preview cache.
-- CREATE-only — no existing table is altered.
--
-- One row per previewed https URL (api/link-preview.mjs). It holds only the
-- clamped OpenGraph title, description and site name the guarded fetch
-- found (ok = 1), or a short-lived failure marker (ok = 0) so a dead or
-- refused link is not re-fetched on every click. No member id is stored:
-- the cache says which links were previewed, never who asked. No image
-- column: previews never carry third-party images.
CREATE TABLE IF NOT EXISTS link_previews (
  url TEXT PRIMARY KEY CHECK (length(url) BETWEEN 9 AND 2048),
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  title TEXT CHECK (title IS NULL OR length(title) <= 200),
  description TEXT CHECK (description IS NULL OR length(description) <= 300),
  site_name TEXT CHECK (site_name IS NULL OR length(site_name) <= 100),
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS link_previews_fetched_at ON link_previews (fetched_at);
