-- MANUAL RECOVERY ONLY. Do not move this file into migrations/.
-- Production's schema already has the nullable TEXT column added by
-- 0019_css_submission_version.sql, but its d1_migrations ledger lacks the
-- corresponding row. This inserts the migration marker only when the required
-- schema is present and no pending CSS row is missing its review version.
-- Snapshot D1 and inspect PRAGMA table_info(users) plus the pending-row
-- invariant before running. If no row is inserted, STOP and investigate.
INSERT INTO d1_migrations (name)
SELECT '0019_css_submission_version.sql'
WHERE NOT EXISTS (
  SELECT 1 FROM d1_migrations
  WHERE name = '0019_css_submission_version.sql'
)
AND EXISTS (
  SELECT 1 FROM pragma_table_info('users')
  WHERE name = 'pending_css_version'
    AND type = 'TEXT'
    AND "notnull" = 0
    AND dflt_value IS NULL
)
AND EXISTS (
  SELECT 1 FROM pragma_table_info('users')
  WHERE name = 'pending_css'
    AND type = 'TEXT'
    AND "notnull" = 0
)
AND EXISTS (
  SELECT 1 FROM pragma_table_info('users')
  WHERE name = 'css_status'
    AND type = 'TEXT'
    AND "notnull" = 1
)
AND NOT EXISTS (
  SELECT 1 FROM users
  WHERE pending_css IS NOT NULL
    AND css_status = 'pending'
    AND (pending_css_version IS NULL OR pending_css_version = '')
);
