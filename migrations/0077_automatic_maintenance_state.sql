-- 0077: concurrency-safe automatic maintenance monitor state.
--
-- Keep the singleton state in the forum's existing D1 database. Each health
-- observation is one atomic UPSERT, so overlapping Cron invocations cannot
-- lose streak increments or overwrite a newer transition.

CREATE TABLE IF NOT EXISTS automatic_maintenance_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  failure_streak INTEGER NOT NULL DEFAULT 0 CHECK (failure_streak >= 0),
  success_streak INTEGER NOT NULL DEFAULT 0 CHECK (success_streak >= 0),
  last_checked_at TEXT,
  last_transition_at TEXT
);

INSERT INTO automatic_maintenance_state (id, active, failure_streak, success_streak)
VALUES (1, 0, 0, 0)
ON CONFLICT(id) DO NOTHING;
