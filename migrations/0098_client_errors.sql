-- 0098_client_errors.sql: anonymous client-side exception counts.
-- Daily aggregates only. No message, stack, URL, IP, cookie, user or timestamp
-- finer than the UTC day is retained.
CREATE TABLE IF NOT EXISTS client_errors_daily (
  day TEXT NOT NULL,
  route TEXT NOT NULL,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route, kind, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_client_errors_daily_day
  ON client_errors_daily (day, route, kind);
