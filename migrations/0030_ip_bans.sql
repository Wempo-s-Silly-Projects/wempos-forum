-- IP bans (v3.1, Pone's ask): ban-evasion resistance. Every member session
-- creation records the caller's KEYED IP hash (HMAC-SHA-256 over
-- PASSWORD_PEPPER — raw IPs are never stored) in known_ips; a ban may copy
-- the member's known hashes into banned_ips, and sign-in/registration from a
-- banned hash is refused. Unbanning (or an appeal approval) removes that
-- ban's rows, so an unban restores network access with the account.

CREATE TABLE known_ips (
  ip_hash TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, user_id)
);
CREATE INDEX idx_known_ips_user ON known_ips (user_id);

CREATE TABLE banned_ips (
  ip_hash TEXT PRIMARY KEY,
  ban_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_banned_ips_ban ON banned_ips (ban_id);
