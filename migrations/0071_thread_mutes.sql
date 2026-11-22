-- 0071_thread_mutes.sql (v5.46.0): mute a thread. CREATE-only — no existing
-- table is altered.
--
-- One row per (member, thread root) the member muted. A muted member gets no
-- reply / subscription / mention / follow_thread notification that
-- originates in that thread: the notification INSERT…SELECTs check this
-- table in SQL (api/notifications.mjs mutedThreadSql), so a mute costs no
-- extra round trip. Chat mentions and invite joins are not thread-scoped and
-- never read it. The route (api/thread-mutes.mjs) only stores thread ROOTS.
-- Both references cascade: D1 enforces foreign keys, so deleting the account
-- or the thread takes the row with it.
CREATE TABLE IF NOT EXISTS thread_mutes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

-- The FK child-side index for the posts cascade (the PK already covers the
-- per-recipient probe and user_id lookups).
CREATE INDEX IF NOT EXISTS idx_thread_mutes_post ON thread_mutes(post_id);
