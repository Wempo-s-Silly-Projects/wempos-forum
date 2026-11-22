-- 0066_profile_extras.sql (v5.38.0): profile pinned thread, custom status and
-- poll closing time. CREATE-only — no existing table is altered.
--
-- Every reference cascades: D1 enforces foreign keys, so a missing cascade
-- would block deleting the account or the post. Every read re-checks the
-- visibility law and the expiry/deadline at read time; nothing here is trusted
-- as "still valid" and no cron job prunes rows.

-- profile_pins: one pinned thread per member (re-pin replaces). The read
-- shows it only while it is still the member's own public root thread and the
-- member holds no active ban.
CREATE TABLE IF NOT EXISTS profile_pins (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  pinned_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS profile_pins_post_idx ON profile_pins (post_id);

-- user_status: a short custom status (text and/or one emoji) with an optional
-- expiry. expires_at NULL = never; an expired row is simply not shown.
CREATE TABLE IF NOT EXISTS user_status (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '' CHECK (length(text) <= 60),
  emoji TEXT NOT NULL DEFAULT '' CHECK (length(emoji) <= 16),
  expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- poll_deadlines: an optional closing time for a thread's poll. A vote after
-- closes_at is refused like a manually closed poll (computed at read time).
CREATE TABLE IF NOT EXISTS poll_deadlines (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  closes_at INTEGER NOT NULL
);
