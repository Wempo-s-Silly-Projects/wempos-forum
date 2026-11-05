-- 0035_totp_2fa.sql (v4.0.1): TOTP two-factor sign-in (2FA only — no
-- recovery codes, no email fallback; the feature spec's scope).
--
-- users gains the enabled secret and a staged (pre-confirmation) secret:
-- totp_enabled is 0 until the member proves possession with a real code at
-- confirm time, at which point the staged secret is promoted in one statement.
-- Secrets are base32 (20 bytes -> 32 chars) — small enough for a text column.
--
-- totp_challenges holds the short-lived login-step tokens issued to members
-- who passed the password check but still owe a code. Only SHA-256 token
-- hashes are stored (same rule as sessions); the plaintext lives solely in
-- the login response. A completed verification or the expiry sweep deletes
-- the row, so each challenge verifies at most once.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE totp_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_totp_challenges_expiry ON totp_challenges(expires_at);
