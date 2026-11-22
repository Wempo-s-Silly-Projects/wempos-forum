-- 0073_saved_searches.sql (v5.48.0): saved searches. CREATE-only — no
-- existing table is altered.
--
-- A member's named shortcut to a forum search: the name plus the search's
-- q / by / in params (validated with api/search.mjs's own constants before
-- they get here; the CHECKs mirror those caps). Visible ONLY to its owner
-- (api/saved-searches.mjs keys every statement on the session's own id) and
-- the owner's data export — never to other members, staff or guests, and no
-- feed, search, MCP tool or page head reads this table. Running a saved
-- search is just a link to the existing search page.
-- name is COLLATE NOCASE so UNIQUE (owner_id, name) refuses "Cats" next to
-- "cats". At most 20 rows per owner, enforced inside the route's INSERT.
-- The owner reference cascades: D1 enforces foreign keys, so deleting the
-- account takes its saved searches with it.
CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 40),
  q TEXT NOT NULL CHECK (length(q) BETWEEN 1 AND 100),
  by_username TEXT CHECK (by_username IS NULL OR length(by_username) BETWEEN 3 AND 24),
  in_scope TEXT CHECK (in_scope IS NULL OR in_scope = 'replies'),
  created_at INTEGER NOT NULL,
  UNIQUE (owner_id, name)
);
-- The UNIQUE index leads with owner_id, so it serves every owner-keyed read,
-- the per-owner COUNT and the owner cascade; no extra index is needed.
