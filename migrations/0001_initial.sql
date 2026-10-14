PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 280),
  avatar_mime TEXT CHECK (avatar_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  avatar_data BLOB CHECK (avatar_data IS NULL OR length(avatar_data) <= 1048576),
  avatar_updated_at INTEGER,
  avatar_version TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    (avatar_mime IS NULL AND avatar_data IS NULL AND avatar_updated_at IS NULL AND avatar_version IS NULL)
    OR (avatar_mime IS NOT NULL AND avatar_data IS NOT NULL AND avatar_updated_at IS NOT NULL AND avatar_version IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin ON users(role) WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'hidden')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(parent_id, visibility, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, parent_id, visibility, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_parent_replies ON posts(parent_id, id ASC);

CREATE TABLE IF NOT EXISTS reactions (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value TEXT NOT NULL CHECK (value IN ('like', 'dislike')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reactions_post_value ON reactions(post_id, value);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_queue ON reports(status, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_one_open_per_reporter
  ON reports(post_id, reporter_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason TEXT CHECK (revocation_reason IS NULL OR length(revocation_reason) <= 500)
);
CREATE INDEX IF NOT EXISTS idx_bans_active ON bans(user_id, revoked_at, expires_at);

