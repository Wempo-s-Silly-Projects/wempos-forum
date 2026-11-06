-- General notifications (v4.2): the notifications table was reply-only
-- shaped — target_post_id and reply_id carry NOT NULL + FK to posts. Appeal
-- outcome rows ("Your appeal was approved") and chat/DM notifications have
-- no post to point at, so writes bound NULL and D1 rejected them
-- (NOT NULL constraint failed) — this was the reported "appeals no worky"
-- (approve/deny both died in the decision batch at the notify statement).
--
-- SQLite cannot relax NOT NULL in place. notifications is a LEAF table —
-- nothing references it — so the rebuild is a simple swap with no cascade
-- danger: stash the AUTOINCREMENT headroom, copy rows, drop, rename, restore
-- the index and the sequence (deleted rows' ids must not be reissued).
--
-- NULL target_post_id/reply_id means "not about a post": the read path
-- surfaces a label-only item and the client marks it read without
-- navigating.

-- 1. Stash the sequence headroom BEFORE the drop (DROP deletes the
--    sqlite_sequence row; the copy rebases on max(id) which is wrong when
--    past rows were deleted).
UPDATE sqlite_sequence SET name = '__notifications_keep__' WHERE name = 'notifications';

-- 2. Copy + swap.
CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  reply_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  label TEXT,
  CHECK (read_at IS NULL OR read_at >= created_at)
);
INSERT INTO notifications_new (id, user_id, target_post_id, reply_id, created_at, read_at, label)
  SELECT id, user_id, target_post_id, reply_id, created_at, read_at, label FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX idx_notifications_user ON notifications(user_id, id DESC);

-- 3. Restore the headroom.
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = '__notifications_keep__')
  WHERE name = 'notifications' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__notifications_keep__');
DELETE FROM sqlite_sequence WHERE name = '__notifications_keep__';
