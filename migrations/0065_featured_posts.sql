-- 0065_featured_posts.sql (v5.35.0): staff pick of the week. CREATE-only — no
-- existing table is altered.
--
-- featured_posts: one row per pick of a public Showcase root by staff
-- (owner/admin). The newest row is the current pick; every read re-checks the
-- post's visibility, so a hidden or banned pick simply doesn't show. Both
-- references cascade: deleting the post or the picking account removes the row
-- (D1 enforces foreign keys, so a missing cascade would block those deletes).
CREATE TABLE IF NOT EXISTS featured_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  picked_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  picked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS featured_posts_newest_idx ON featured_posts (picked_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS featured_posts_post_idx ON featured_posts (post_id);
CREATE INDEX IF NOT EXISTS featured_posts_picker_idx ON featured_posts (picked_by);

-- staff_pick_log: the mod log for picks — one row per pick or unpick, read on
-- the desk (staff only). post_id is a plain number (no reference) so the
-- record outlives a deleted post; the actor cascades with their account.
CREATE TABLE IF NOT EXISTS staff_pick_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('pick', 'unpick')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS staff_pick_log_actor_idx ON staff_pick_log (actor_id);
