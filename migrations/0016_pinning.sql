-- Pinning (v3.0 C5): moderators/admins pin threads — ALTER only (SQLite can't
-- add a CHECK with ADD COLUMN and none is needed: the API writes stamps or
-- NULL, nothing else). Pinned roots float FIRST in the home feed; unpinned
-- pagination rides the (last_activity_at, id) cursor exactly as before (the
-- pinned rows that also sit below a cursor page are a documented rough edge —
-- they re-appear, sorted first, until the moderator unpins).
ALTER TABLE posts ADD COLUMN pinned_at INTEGER;