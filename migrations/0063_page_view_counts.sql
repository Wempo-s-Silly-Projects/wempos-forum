-- 0063_page_view_counts.sql (v5.30.0): private, first-party analytics.
-- CREATE-only — no existing table is altered.
--
-- AGGREGATE COUNTS ONLY. One row per (UTC day, page type) and one per
-- (UTC day, referring site host). There is deliberately no column for an IP
-- address, a member id, a user agent, a cookie, a full URL or a per-visit
-- row: nothing here can tell anyone who visited. `route` is the client
-- router's route NAME ("home", "post", "profile"...), never a path, a thread
-- id or a username. Rows older than 90 days are removed when staff read them.
CREATE TABLE IF NOT EXISTS page_view_counts (
  day TEXT NOT NULL,
  route TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route)
);

CREATE TABLE IF NOT EXISTS referrer_counts (
  day TEXT NOT NULL,
  referrer_host TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, referrer_host)
);
