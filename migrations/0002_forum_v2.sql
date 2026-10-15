-- Migration 0002 (forum v2): users table rebuild (bio limit 10000, moderator role,
-- avatar_status + pending-avatar mirror set, social/polytoria handles), posts
-- activity tracking, notifications table.
--
-- Strategy (controller-ruled, 12-step style): D1 keeps foreign key enforcement ON
-- and does not allow turning it off, so the users table cannot be dropped while
-- child rows reference it (DROP TABLE's implicit DELETE fires ON DELETE CASCADE
-- immediately; defer_foreign_keys only defers violation ERRORS, never actions).
-- Every child table of users is therefore rebuilt alongside it: all six tables are
-- copied into *_new tables before any old table is dropped, drops cascade only into
-- already-copied rows, and the final renames let SQLite's own ALTER TABLE RENAME
-- rewrite the *_new children's REFERENCES clauses to the final names.

PRAGMA defer_foreign_keys = true;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 10000),
  social_youtube TEXT CHECK (social_youtube IS NULL OR length(social_youtube) <= 120),
  social_x TEXT CHECK (social_x IS NULL OR length(social_x) <= 120),
  social_reddit TEXT CHECK (social_reddit IS NULL OR length(social_reddit) <= 120),
  social_github TEXT CHECK (social_github IS NULL OR length(social_github) <= 120),
  social_discord TEXT CHECK (social_discord IS NULL OR length(social_discord) <= 120),
  social_gitlab TEXT CHECK (social_gitlab IS NULL OR length(social_gitlab) <= 120),
  social_instagram TEXT CHECK (social_instagram IS NULL OR length(social_instagram) <= 120),
  social_tiktok TEXT CHECK (social_tiktok IS NULL OR length(social_tiktok) <= 120),
  social_twitch TEXT CHECK (social_twitch IS NULL OR length(social_twitch) <= 120),
  polytoria_username TEXT CHECK (polytoria_username IS NULL OR length(polytoria_username) <= 120),
  avatar_status TEXT CHECK (avatar_status IS NULL OR avatar_status IN ('approved', 'pending', 'rejected')),
  avatar_mime TEXT CHECK (avatar_mime IS NULL OR avatar_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  avatar_data BLOB CHECK (avatar_data IS NULL OR length(avatar_data) <= 1048576),
  avatar_updated_at INTEGER,
  avatar_version TEXT,
  pending_avatar_mime TEXT CHECK (pending_avatar_mime IS NULL OR pending_avatar_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  pending_avatar_data BLOB CHECK (pending_avatar_data IS NULL OR length(pending_avatar_data) <= 1048576),
  pending_avatar_updated_at INTEGER,
  pending_avatar_version TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    (avatar_mime IS NULL AND avatar_data IS NULL AND avatar_updated_at IS NULL AND avatar_version IS NULL)
    OR (avatar_mime IS NOT NULL AND avatar_data IS NOT NULL AND avatar_updated_at IS NOT NULL AND avatar_version IS NOT NULL)
  ),
  CHECK (
    (pending_avatar_mime IS NULL AND pending_avatar_data IS NULL AND pending_avatar_updated_at IS NULL AND pending_avatar_version IS NULL)
    OR (pending_avatar_mime IS NOT NULL AND pending_avatar_data IS NOT NULL AND pending_avatar_updated_at IS NOT NULL AND pending_avatar_version IS NOT NULL)
  ),
  CHECK (
    CASE
      WHEN avatar_status IS NULL
        THEN avatar_mime IS NULL AND pending_avatar_mime IS NULL
      WHEN avatar_status = 'approved'
        THEN avatar_mime IS NOT NULL AND pending_avatar_mime IS NULL
      WHEN avatar_status = 'pending'
        THEN pending_avatar_mime IS NOT NULL
      ELSE -- 'rejected' is a transient handler value: both sets empty
        avatar_mime IS NULL AND pending_avatar_mime IS NULL
    END
  )
);

-- Existing avatars become 'approved'; users without avatars stay NULL (never-uploaded state).
-- Social/polytoria handles and the pending-avatar mirror set are NULL everywhere initially.
INSERT INTO users_new (
  id, username, username_key, password_salt, password_hash, role, bio,
  social_youtube, social_x, social_reddit, social_github, social_discord,
  social_gitlab, social_instagram, social_tiktok, social_twitch, polytoria_username,
  avatar_mime, avatar_data, avatar_updated_at, avatar_version,
  avatar_status,
  pending_avatar_mime, pending_avatar_data, pending_avatar_updated_at, pending_avatar_version,
  created_at
)
SELECT
  id, username, username_key, password_salt, password_hash, role, bio,
  NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  avatar_mime, avatar_data, avatar_updated_at, avatar_version,
  CASE WHEN avatar_mime IS NULL THEN NULL ELSE 'approved' END,
  NULL, NULL, NULL, NULL,
  created_at
FROM users;

-- Child tables of users, rebuilt with the same columns/CHECKs/actions as 0001 but
-- with their users FK clauses written against users_new so the final rename keeps
-- them resolving to the rebuilt users table.
CREATE TABLE sessions_new (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users_new(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE posts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES posts_new(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'hidden')),
  created_at INTEGER NOT NULL
);

CREATE TABLE reactions_new (
  post_id INTEGER NOT NULL REFERENCES posts_new(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  value TEXT NOT NULL CHECK (value IN ('like', 'dislike')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts_new(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER REFERENCES users_new(id) ON DELETE SET NULL
);

CREATE TABLE bans_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users_new(id) ON DELETE SET NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by INTEGER REFERENCES users_new(id) ON DELETE SET NULL,
  revocation_reason TEXT CHECK (revocation_reason IS NULL OR length(revocation_reason) <= 500)
);

INSERT INTO sessions_new SELECT token_hash, user_id, csrf_token, created_at, expires_at FROM sessions;
INSERT INTO posts_new SELECT id, author_id, parent_id, body, visibility, created_at FROM posts;
INSERT INTO reactions_new SELECT post_id, user_id, value, created_at FROM reactions;
INSERT INTO reports_new SELECT id, post_id, reporter_id, reason, status, created_at, resolved_at, resolved_by FROM reports;
INSERT INTO bans_new SELECT id, user_id, reason, created_at, created_by, expires_at, revoked_at, revoked_by, revocation_reason FROM bans;

-- All six old tables' rows are already copied; the drops may cascade freely.
-- Order matters: posts is self-referential, so it must be dropped while its FK
-- clause parents (itself, users) still resolve — SQLite refuses to drop a table
-- that carries both a self-FK and an FK to an already-dropped parent. The empty
-- reactions/reports tables then drop cleanly with their now-missing posts FK
-- clause (empty + no self-FK is safe), and users goes last with no old children left.
DROP TABLE posts;
DROP TABLE sessions;
DROP TABLE bans;
DROP TABLE reports;
DROP TABLE reactions;
DROP TABLE users;

-- The renames rewrite the *_new children's REFERENCES clauses to the final names.
ALTER TABLE users_new RENAME TO users;
ALTER TABLE sessions_new RENAME TO sessions;
ALTER TABLE posts_new RENAME TO posts;
ALTER TABLE reactions_new RENAME TO reactions;
ALTER TABLE reports_new RENAME TO reports;
ALTER TABLE bans_new RENAME TO bans;

-- Recreate every index from 0001.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin ON users(role) WHERE role = 'admin';
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(parent_id, visibility, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, parent_id, visibility, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_parent_replies ON posts(parent_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_reactions_post_value ON reactions(post_id, value);
CREATE INDEX IF NOT EXISTS idx_reports_queue ON reports(status, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_one_open_per_reporter
  ON reports(post_id, reporter_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_bans_active ON bans(user_id, revoked_at, expires_at);

ALTER TABLE posts ADD COLUMN last_activity_at INTEGER;

UPDATE posts SET last_activity_at = (
  COALESCE((SELECT MAX(r.created_at) FROM posts r WHERE r.parent_id = posts.id), created_at)
) WHERE parent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_activity ON posts(last_activity_at DESC, id DESC) WHERE parent_id IS NULL AND visibility='public';

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reply_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  CHECK (read_at IS NULL OR read_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);