-- Profile wall (v4.0, owner's ask): visitors leave short posts on a member's
-- profile; the profile OWNER may pin/unpin wall posts (pinned sort first) and
-- can do nothing else to them — no edit, no delete, no replies. Bodies are
-- 1–280 chars, word-filtered at intake, and text auto-mod scores them in the
-- background like chat (a trip deletes; the action is appealable). Rows by
-- actively banned authors vanish at read time (the chat ban-filter shape,
-- keyed on author_id) — no write-time sweep needed; unban restores them.
CREATE TABLE IF NOT EXISTS wall_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 280),
  pinned_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wall_posts_owner
  ON wall_posts(owner_id, pinned_at, id DESC);
CREATE INDEX IF NOT EXISTS idx_wall_posts_author
  ON wall_posts(author_id, id DESC);
