-- 0075_thread_locks.sql (v5.51.0): staff thread lock.
-- CREATE-only — no existing table is altered.
--
-- One row per locked ROOT post (api/thread-locks.mjs). While the row exists,
-- both reply paths (api/replies.mjs and the MCP reply tool in api/mcp.mjs)
-- refuse non-staff replies with 423 after one primary-key lookup on the
-- root. POST_SELECT reads only EXISTS(row) as the public `locked` flag; the
-- reason and the locker are staff-only and served solely by
-- GET /api/admin/threads/:id/lock.
-- Both references cascade: D1 enforces foreign keys, so deleting the thread
-- or the staff account that locked it takes the row with it.
CREATE TABLE IF NOT EXISTS thread_locks (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  locked_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 200),
  locked_at INTEGER NOT NULL
);

-- The FK child-side index for the locker cascade (the PK covers post_id).
CREATE INDEX IF NOT EXISTS idx_thread_locks_locked_by ON thread_locks(locked_by);
