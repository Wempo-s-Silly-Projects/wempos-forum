-- 0081_account_security.sql (Batch F, account security). CREATE-only: no
-- existing table is altered (D1 enforces FKs — never rebuild users).
--
-- totp_used_steps: the last TOTP time step each member has spent. A code is
-- accepted only when its step is STRICTLY newer than the stored one, claimed
-- by one conditional upsert, so a code seen once (shoulder-surfed, replayed
-- from a log, raced in two tabs) can never verify a second time inside its
-- ±1-step window. Account deletion takes the row (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS totp_used_steps (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_step INTEGER NOT NULL
);

-- passkeys: WebAuthn credentials registered as an ADDITIONAL sign-in method.
-- credential_id and public_key are base64url; only public material is stored.
-- counter is the authenticator's signature counter (0 for most passkeys).
CREATE TABLE IF NOT EXISTS passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

-- webauthn_challenges: single-use ceremony challenges. Only the SHA-256 of
-- the challenge is stored, bound to the session that asked for it (the
-- member session for registration, the guest session for sign-in). The
-- verify step claims the row with one guarded DELETE; a replayed or expired
-- challenge matches nothing.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  session_hash TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges(expires_at);

-- altcha_spent: proof-of-work solutions already redeemed. The SHA-256 of the
-- challenge signature is the key; a second redemption of the same solved
-- challenge hits the primary key and is refused. Rows past expires_at are
-- swept on the next verification.
CREATE TABLE IF NOT EXISTS altcha_spent (
  signature_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_altcha_spent_expiry ON altcha_spent(expires_at);
