-- Accountability archive (v2.4.1): every post row that vanishes through an
-- author post-delete or an account delete is COPIED here first, inside the
-- same atomic batch as the deletion. Served publicly at GET /api/archive so
-- deleting is never a way to scrub words (rooman98's anti-scrub ask).
CREATE TABLE post_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_post_id INTEGER NOT NULL,
  author_id INTEGER,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  board TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL,
  deleted_because TEXT NOT NULL CHECK (deleted_because IN ('post-delete', 'account-delete'))
);
CREATE INDEX idx_post_archive_deleted ON post_archive(deleted_at, id);