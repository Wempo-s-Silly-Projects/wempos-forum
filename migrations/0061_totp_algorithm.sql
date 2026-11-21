-- 0061_totp_algorithm.sql (v5.20.0): the per-member TOTP algorithm, chosen
-- at two-factor setup. CREATE-only — no existing table is altered: a member
-- with NO row here verifies with SHA1, which is every enrollment made before
-- v5.20.0, so nobody's authenticator stops working.
--
-- Setup writes the chosen algorithm (SHA1 default, SHA256 opt-in) next to
-- the staged secret, only while two-factor is off; confirm proves a code
-- under that algorithm before 2FA turns on, so a wrong authenticator choice
-- fails at setup, never at sign-in. Turning 2FA off deletes the row in the
-- same batch; account deletion takes it with the user (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS totp_algorithms (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL CHECK (algorithm IN ('SHA1', 'SHA256')),
  created_at INTEGER NOT NULL
);
