-- Bookmarks (v3.0 C4): a member's PRIVATE saved list. There is a single row
-- per (member, post) — PUT is idempotent — and everything cascades: a deleted
-- post or account removes its rows. Lists read only their own rows.
CREATE TABLE bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX idx_bookmarks_user_time ON bookmarks(user_id, created_at);