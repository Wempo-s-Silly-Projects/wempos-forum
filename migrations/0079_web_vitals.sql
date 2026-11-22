-- 0079_web_vitals.sql: anonymous Core Web Vitals, DAILY AGGREGATES ONLY.
-- CREATE-only — no existing table is altered.
--
-- One row per (UTC day, page type, metric): a sample count plus 21 fixed
-- histogram buckets (b0..b20; edges in constants.mjs, b20 = overflow), so a
-- 75th percentile can be read without keeping any single measurement. There
-- is deliberately no column for an IP address, a member id, a user agent, a
-- cookie, a URL or a time finer than the day. `route` is the client router's
-- route NAME ("home", "post"...), never a path, id or slug. Rows older than
-- 90 days are pruned on write and on the staff read.
CREATE TABLE IF NOT EXISTS web_vitals_daily (
  day TEXT NOT NULL,
  route TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  b0 INTEGER NOT NULL DEFAULT 0,
  b1 INTEGER NOT NULL DEFAULT 0,
  b2 INTEGER NOT NULL DEFAULT 0,
  b3 INTEGER NOT NULL DEFAULT 0,
  b4 INTEGER NOT NULL DEFAULT 0,
  b5 INTEGER NOT NULL DEFAULT 0,
  b6 INTEGER NOT NULL DEFAULT 0,
  b7 INTEGER NOT NULL DEFAULT 0,
  b8 INTEGER NOT NULL DEFAULT 0,
  b9 INTEGER NOT NULL DEFAULT 0,
  b10 INTEGER NOT NULL DEFAULT 0,
  b11 INTEGER NOT NULL DEFAULT 0,
  b12 INTEGER NOT NULL DEFAULT 0,
  b13 INTEGER NOT NULL DEFAULT 0,
  b14 INTEGER NOT NULL DEFAULT 0,
  b15 INTEGER NOT NULL DEFAULT 0,
  b16 INTEGER NOT NULL DEFAULT 0,
  b17 INTEGER NOT NULL DEFAULT 0,
  b18 INTEGER NOT NULL DEFAULT 0,
  b19 INTEGER NOT NULL DEFAULT 0,
  b20 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route, metric)
);
