-- Composer body cap (owner-set, follows the main commit that raised
-- MAX_COMPOSER_BODY_CHARS 1000 → 4750): the posts table's body CHECK still
-- caps every root post and reply at 2000, so any longer body passes the
-- app-level gate and then 500s on the constraint. This migration relaxes the
-- CHECK to 1..4750 (matching api/posts-write.mjs and public/js/composer-
-- limits.js, which already mirror 4750).
--
-- D1 CAVEATS THAT SHAPE THIS FILE (do not "simplify" it back to the classic
-- SQLite recipe):
--   * PRAGMA foreign_keys=OFF is ignored on D1 (every query runs in its own
--     implicit transaction), and PRAGMA defer_foreign_keys does NOT stop
--     ON DELETE CASCADE actions — cascades fire the moment a row is deleted.
--   * DROP TABLE posts would therefore cascading-wipe every child table
--     (reactions, reports, notifications, attachments, post_edits,
--     thread_subscriptions, polls — and through polls, poll_options/poll_votes;
--     through attachments, attachment_chunks). SQLite cannot alter a CHECK in
--     place, so the only safe path is the full-tree rebuild: copy each table
--     into a twin whose foreign keys point at the twin names, drop the
--     originals (any cascade then only ever hits an original whose rows were
--     already copied), and rename the twins back — the posts rename rewrites
--     every "posts_rebuild" reference to "posts" in one step.
--   * The posts self-FK points at posts_rebuild while rebuilding so the old
--     table's drop cannot cascade into the copy; the rename repoints it.
--   * AUTOINCREMENT sequence rows (posts, reports, notifications, post_edits,
--     polls, poll_options) are preserved so ids of previously deleted rows are
--     never reissued.

PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. posts copy (the only body CHECK that changes)
-- ---------------------------------------------------------------------------
CREATE TABLE posts_rebuild (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4750),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'hidden')),
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER,
  edited_at INTEGER,
  board TEXT NOT NULL DEFAULT 'general',
  view_count INTEGER NOT NULL DEFAULT 0,
  pinned_at INTEGER,
  idempotency_key TEXT,
  idempotency_fingerprint TEXT,
  staged_at INTEGER,
  suggestion_status TEXT
    CHECK (suggestion_status IS NULL OR suggestion_status IN ('resolved', 'declined')),
  suggestion_decided_by INTEGER,
  suggestion_decided_at INTEGER
);
INSERT INTO posts_rebuild
  (id, author_id, parent_id, body, visibility, created_at,
   last_activity_at, edited_at, board, view_count, pinned_at,
   idempotency_key, idempotency_fingerprint, staged_at,
   suggestion_status, suggestion_decided_by, suggestion_decided_at)
SELECT id, author_id, parent_id, body, visibility, created_at,
       last_activity_at, edited_at, board, view_count, pinned_at,
       idempotency_key, idempotency_fingerprint, staged_at,
       suggestion_status, suggestion_decided_by, suggestion_decided_at
  FROM posts ORDER BY id;
UPDATE sqlite_sequence SET name = '__posts_keep__' WHERE name = 'posts';

-- ---------------------------------------------------------------------------
-- 2. leaf copies (reactions, reports, notifications, post_edits,
--    thread_subscriptions, bookmarks) — FKs point at posts_rebuild; the final
--    rename rewrites them
-- ---------------------------------------------------------------------------
CREATE TABLE reactions_new (
  post_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  value TEXT NOT NULL CHECK (value IN ('like', 'dislike')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
INSERT INTO reactions_new (post_id, user_id, value, created_at)
  SELECT post_id, user_id, value, created_at FROM reactions;
DROP TABLE reactions;
ALTER TABLE reactions_new RENAME TO reactions;

CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER REFERENCES "users"(id) ON DELETE SET NULL
);
INSERT INTO reports_new (id, post_id, reporter_id, reason, status, created_at, resolved_at, resolved_by)
  SELECT id, post_id, reporter_id, reason, status, created_at, resolved_at, resolved_by FROM reports;
UPDATE sqlite_sequence SET name = '__reports_keep__' WHERE name = 'reports';
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;

CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_post_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  reply_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  label TEXT,
  CHECK (read_at IS NULL OR read_at >= created_at)
);
INSERT INTO notifications_new (id, user_id, target_post_id, reply_id, created_at, read_at, label)
  SELECT id, user_id, target_post_id, reply_id, created_at, read_at, label FROM notifications;
UPDATE sqlite_sequence SET name = '__notifications_keep__' WHERE name = 'notifications';
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE TABLE post_edits_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  editor_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  edited_at INTEGER NOT NULL
);
INSERT INTO post_edits_new (id, post_id, editor_id, body, edited_at)
  SELECT id, post_id, editor_id, body, edited_at FROM post_edits;
UPDATE sqlite_sequence SET name = '__post_edits_keep__' WHERE name = 'post_edits';
DROP TABLE post_edits;
ALTER TABLE post_edits_new RENAME TO post_edits;

CREATE TABLE thread_subscriptions_new (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
INSERT INTO thread_subscriptions_new (user_id, post_id, created_at)
  SELECT user_id, post_id, created_at FROM thread_subscriptions;
DROP TABLE thread_subscriptions;
ALTER TABLE thread_subscriptions_new RENAME TO thread_subscriptions;

CREATE TABLE bookmarks_new (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
INSERT INTO bookmarks_new (user_id, post_id, created_at)
  SELECT user_id, post_id, created_at FROM bookmarks;
DROP TABLE bookmarks;
ALTER TABLE bookmarks_new RENAME TO bookmarks;

-- ---------------------------------------------------------------------------
-- 3. attachments subtree (attachment_chunks hangs off attachments with CASCADE,
--    so BOTH are rebuilt before either original is dropped)
-- ---------------------------------------------------------------------------
CREATE TABLE attachments_new (
  id TEXT PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  hash TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL DEFAULT 'legacy' CHECK (source_kind IN ('legacy', 'upload', 'gif')),
  source_gif_id TEXT
);
INSERT INTO attachments_new (id, post_id, created_by, created_at, mime, version, status, hash, source_kind, source_gif_id)
  SELECT id, post_id, created_by, created_at, mime, version, status, hash, source_kind, source_gif_id FROM attachments;
CREATE TABLE attachment_chunks_new (
  attachment_id TEXT NOT NULL REFERENCES attachments_new(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pending', 'approved')),
  seq INTEGER NOT NULL,
  data BLOB NOT NULL CHECK (length(data) <= 2000000),
  PRIMARY KEY (attachment_id, kind, seq)
);
INSERT INTO attachment_chunks_new (attachment_id, kind, seq, data)
  SELECT attachment_id, kind, seq, data FROM attachment_chunks;
DROP TABLE attachment_chunks;
DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;
ALTER TABLE attachment_chunks_new RENAME TO attachment_chunks;

-- ---------------------------------------------------------------------------
-- 4. polls subtree (poll_options and poll_votes hang off polls with CASCADE —
--    rebuild all three before dropping the original polls)
-- ---------------------------------------------------------------------------
CREATE TABLE polls_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts_rebuild(id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (length(question) <= 200),
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
INSERT INTO polls_new (id, post_id, question, created_at, closed_at)
  SELECT id, post_id, question, created_at, closed_at FROM polls;
UPDATE sqlite_sequence SET name = '__polls_keep__' WHERE name = 'polls';
CREATE TABLE poll_options_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls_new(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) <= 80),
  position INTEGER NOT NULL
);
INSERT INTO poll_options_new (id, poll_id, label, position)
  SELECT id, poll_id, label, position FROM poll_options;
UPDATE sqlite_sequence SET name = '__poll_options_keep__' WHERE name = 'poll_options';
CREATE TABLE poll_votes_new (
  poll_id INTEGER NOT NULL REFERENCES polls_new(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options_new(id) ON DELETE CASCADE,
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
INSERT INTO poll_votes_new (poll_id, user_id, option_id, voted_at)
  SELECT poll_id, user_id, option_id, voted_at FROM poll_votes;
DROP TABLE poll_options;
DROP TABLE poll_votes;
DROP TABLE polls;
ALTER TABLE polls_new RENAME TO polls;
ALTER TABLE poll_options_new RENAME TO poll_options;
ALTER TABLE poll_votes_new RENAME TO poll_votes;

-- ---------------------------------------------------------------------------
-- 5. swap the posts table in — no table references "posts" at this point, so
--    the drop's implicit DELETE fires only the table's own self-cascade; the
--    rename rewrites every "posts_rebuild" foreign key reference to "posts"
-- ---------------------------------------------------------------------------
DROP TABLE posts;
ALTER TABLE posts_rebuild RENAME TO posts;

-- ---------------------------------------------------------------------------
-- 6. indexes (rebuilt on the final names)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_posts_feed ON posts(parent_id, visibility, id DESC);
CREATE INDEX idx_posts_author ON posts(author_id, parent_id, visibility, id DESC);
CREATE INDEX idx_posts_parent_replies ON posts(parent_id, id ASC);
CREATE INDEX idx_posts_activity ON posts(last_activity_at DESC, id DESC) WHERE parent_id IS NULL AND visibility='public';
CREATE UNIQUE INDEX idx_posts_author_idempotency_key
  ON posts(author_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_reactions_post_value ON reactions(post_id, value);
CREATE INDEX idx_reports_queue ON reports(status, created_at ASC);
CREATE UNIQUE INDEX idx_reports_one_open_per_reporter
  ON reports(post_id, reporter_id) WHERE status = 'open';
CREATE INDEX idx_notifications_user ON notifications(user_id, id DESC);
CREATE INDEX idx_attachments_post ON attachments(post_id);
CREATE INDEX idx_attachments_pending ON attachments(status) WHERE status = 'pending';
CREATE INDEX idx_attachments_hash ON attachments(hash);
CREATE INDEX idx_attachments_source_gif
  ON attachments(post_id, source_gif_id)
  WHERE source_gif_id IS NOT NULL;
CREATE INDEX idx_post_edits_post ON post_edits(post_id, edited_at);
CREATE INDEX idx_thread_subscriptions_post ON thread_subscriptions(post_id);
CREATE UNIQUE INDEX idx_polls_post ON polls(post_id);
CREATE INDEX idx_bookmarks_user_time ON bookmarks(user_id, created_at);

-- ---------------------------------------------------------------------------
-- 7. restore the AUTOINCREMENT headroom (the copies rebase seq on max(id);
--    previously deleted rows' ids must never be reissued)
-- ---------------------------------------------------------------------------
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = '__posts_keep__')
  WHERE name = 'posts' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__posts_keep__');
DELETE FROM sqlite_sequence WHERE name = '__posts_keep__';
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = '__reports_keep__')
  WHERE name = 'reports' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__reports_keep__');
DELETE FROM sqlite_sequence WHERE name = '__reports_keep__';
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = '__notifications_keep__')
  WHERE name = 'notifications' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__notifications_keep__');
DELETE FROM sqlite_sequence WHERE name = '__notifications_keep__';
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = '__post_edits_keep__')
  WHERE name = 'post_edits' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__post_edits_keep__');
DELETE FROM sqlite_sequence WHERE name = '__post_edits_keep__';
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = '__polls_keep__')
  WHERE name = 'polls' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__polls_keep__');
DELETE FROM sqlite_sequence WHERE name = '__polls_keep__';
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = '__poll_options_keep__')
  WHERE name = 'poll_options' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__poll_options_keep__');
DELETE FROM sqlite_sequence WHERE name = '__poll_options_keep__';

PRAGMA defer_foreign_keys = OFF;
