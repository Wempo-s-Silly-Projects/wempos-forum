-- 0068_notification_prefs.sql (v5.40.0): per-kind notification preferences.
-- CREATE-only — no existing table is altered.
--
-- One row per member who has changed anything; no row = every kind on.
-- `muted` is a comma-separated list drawn from the fixed allowlist in
-- api/notifications.mjs (NOTIFICATION_KINDS): reply, subscription, mention,
-- chat_mention, follow_thread, invite_joined. The route validates every
-- entry; the notification INSERT…SELECTs read it in SQL. Appeal outcomes
-- (safety notices) are not in the list and can never be muted.
-- The member reference cascades: D1 enforces foreign keys, so deleting the
-- account takes the row with it.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  muted TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
