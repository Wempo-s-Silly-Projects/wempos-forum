-- 0042_totp_backup_codes.sql: single-use TOTP backup codes (v4.8.1) — the
-- Discord-style one-time sign-in codes used INSTEAD of the authenticator code
-- when the authenticator app is lost or renamed. One row per code; only the
-- SHA-256 hex hash is ever stored (the same rule as totp_challenges and
-- sessions) — the raw 8-character base64url code lives solely in the
-- generation response and is never persisted or shown again.
--
-- used_at stays NULL until the code burns at login; a code is claimed at most
-- once by the single guarded DELETE (user_id + code_hash + used_at IS NULL),
-- so a replay or a concurrent retry can never verify twice. Deleting the
-- user's TOTP deletes the codes with the account (ON DELETE CASCADE), and
-- turning two-factor off wipes them with the disable statement.

CREATE TABLE IF NOT EXISTS totp_backup_codes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS idx_totp_backup_codes_user ON totp_backup_codes(user_id);
