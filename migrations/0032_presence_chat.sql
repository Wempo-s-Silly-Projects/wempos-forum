-- Live chat + online presence (v3.1, Desen's ask): polling-based — no
-- Durable Objects. Presence is a D1 heartbeat: signed-in members ping every
-- minute; anyone whose last_seen is within 3 minutes counts as online.
-- Invisible members keep heartbeating (their own view stays live) but are
-- excluded from the public count — lurk freely.
--
-- Chat messages are word-filtered like every other stored member-written
-- text, polled with an after=<id> cursor, and disappear at read time under an
-- active ban (the same read-time semantics as posts). Account deletion
-- cascades both tables away with everything else the member owned.
CREATE TABLE presence (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen INTEGER NOT NULL,
  invisible INTEGER NOT NULL DEFAULT 0 CHECK (invisible IN (0, 1))
);
CREATE INDEX idx_presence_active ON presence(last_seen, invisible);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL
);

-- 1:1 DMs (v3.1): private threads between two members, on the same scrutiny
-- rules as posts — word-filtered, ban-hidden at read time, author/staff
-- deletable, and fully logged for the desk (the owner's call: DMs are
-- reviewable, not a blind spot). Canonical participant ordering
-- (user_a < user_b) makes the UNIQUE pair the find-or-create key.
CREATE TABLE dm_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE TABLE dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_dm_messages_thread ON dm_messages(thread_id, id);
