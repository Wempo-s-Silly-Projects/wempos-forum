-- 0064_invites.sql (v5.34.0): private invite links. CREATE-only — no existing
-- table is altered.
--
-- One row per member who signed up through someone's /join?ref=<username>
-- link: who invited them and when. Nothing else is stored (no click counts,
-- no referrer, no IP). Nothing here is shown publicly; the new member sees
-- "Invited by @user" on their welcome card and the inviter gets one bell row.
-- Both columns cascade, so deleting either account removes the row.
CREATE TABLE IF NOT EXISTS invites (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS invites_inviter_idx ON invites (inviter_id);
