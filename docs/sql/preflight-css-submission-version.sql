-- CONDITIONAL, READ-ONLY CSS preflight.
-- Run only when docs/sql/preflight-production-migration-history.sql reports has_0019_column = 1.
-- This file references pending_css_version directly and will fail if migration 0019's
-- nullable TEXT column is absent. Do not run before checking the schema-ready flag.
SELECT COUNT(*) AS pending_css_missing_version
FROM users
WHERE pending_css IS NOT NULL
  AND css_status = 'pending'
  AND (pending_css_version IS NULL OR pending_css_version = '');
