-- 0074_thread_summaries.sql (v5.50.0): the author's TL;DR on a thread.
-- CREATE-only — no existing table is altered.
--
-- One row per ROOT post: a short summary (1-280 characters) the thread's
-- author or staff may set (api/thread-summaries.mjs). It is public text,
-- read only through GET /api/posts/:id/summary under canViewPost, so a
-- hidden, banned-author or block-paired thread never serves it. The feed
-- (api/posts-feed.mjs) and POST_SELECT never read this table.
-- Both references cascade: D1 enforces foreign keys, so deleting the thread
-- or the account that wrote the summary takes the row with it.
CREATE TABLE IF NOT EXISTS thread_summaries (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 280),
  updated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
);

-- The FK child-side index for the writer cascade (the PK covers post_id).
CREATE INDEX IF NOT EXISTS idx_thread_summaries_updated_by ON thread_summaries(updated_by);
