-- 0060: AutoMod server side (v5.18.0). CREATE-only.
-- automod_actions: the AutoMod log. 0039 removed moderation_actions, so no
--   mod log table exists; every AutoMod hide/ban/report writes one row here
--   (actor is always 'AutoMod') so staff can see and reverse it on the desk.
-- dm_reports: member-facing "Report this conversation". A 1:1 DM thread
--   enters the AutoMod queue ONLY through a row here; unreported DMs never do.
-- automod_profile_edits: one row per profile edit while AutoMod is switched
--   on, giving the queue a monotonic cursor (users has no edit timestamp).

CREATE TABLE IF NOT EXISTS automod_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT 'AutoMod' CHECK (actor = 'AutoMod'),
  action TEXT NOT NULL CHECK (action IN ('hide', 'ban', 'report')),
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'lobby', 'wall', 'profile', 'dm')),
  target_id INTEGER NOT NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  ban_id INTEGER,
  ban_hours INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automod_actions_target ON automod_actions (target_type, target_id, action);
CREATE INDEX IF NOT EXISTS idx_automod_actions_user ON automod_actions (target_user_id);

CREATE TABLE IF NOT EXISTS dm_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_reports_open ON dm_reports (thread_id, reporter_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_dm_reports_reporter ON dm_reports (reporter_id);

CREATE TABLE IF NOT EXISTS automod_profile_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automod_profile_edits_user ON automod_profile_edits (user_id);
