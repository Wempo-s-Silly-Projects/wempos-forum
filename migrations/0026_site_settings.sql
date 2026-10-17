-- Rules page (v2.5): owner-editable site copy (the /rules page renders it
-- through the markdown subset). A tiny key/value table; the rules live under
-- the "rules" key.
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
