-- READ-ONLY preflight for the known production schema/ledger divergence.
-- Run only after confirming the database ID in wrangler.toml. This file performs SELECTs only.
-- Do not run the normal Wrangler migration command if the schema-ready flags are false.
-- If has_0019_column is 1, run preflight-css-submission-version.sql separately.
-- Keeping that query separate lets this preflight run when the column is absent.
SELECT
  EXISTS (SELECT 1 FROM pragma_table_info('users')
    WHERE name = 'pending_css_version' AND type = 'TEXT' AND "notnull" = 0) AS has_0019_column,
  EXISTS (SELECT 1 FROM pragma_table_info('posts') WHERE name = 'idempotency_key')
    AND EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index'
      AND name = 'idx_posts_author_idempotency_key') AS has_0021_effects,
  EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table'
    AND name = 'revoked_attachment_hashes') AS has_0022_effects,
  EXISTS (SELECT 1 FROM pragma_table_info('post_archive') WHERE name = 'deleted_by_user_id')
    AND EXISTS (SELECT 1 FROM pragma_table_info('post_archive') WHERE name = 'deleted_by_name')
    AS has_0023_effects,
  (SELECT COUNT(*) FROM attachments AS a
    WHERE a.status = 'approved' AND a.hash <> ''
      AND NOT EXISTS (SELECT 1 FROM attachment_chunks c
        WHERE c.attachment_id = a.id AND c.kind = 'approved')
      AND NOT EXISTS (SELECT 1 FROM attachments AS src
        JOIN attachment_chunks c ON c.attachment_id = src.id AND c.kind = 'approved'
        WHERE src.status = 'approved' AND src.hash = a.hash AND src.id <> a.id)
      AND NOT EXISTS (SELECT 1 FROM gifs g
        WHERE g.status = 'approved' AND g.hash = a.hash)
  ) AS approved_uploads_without_bytes_or_source,
  (SELECT COUNT(*) FROM attachments AS a
    WHERE a.status = 'approved' AND a.hash <> ''
      AND NOT EXISTS (SELECT 1 FROM attachment_chunks c
        WHERE c.attachment_id = a.id AND c.kind = 'approved')
      AND EXISTS (SELECT 1 FROM gifs g
        WHERE g.status = 'approved' AND g.hash = a.hash)
  ) AS gif_backed_aliases_keep_by_reference;

SELECT name, applied_at FROM d1_migrations
WHERE name IN (
  '0019_css_submission_version.sql',
  '0020_materialize_approved_attachment_bytes.sql',
  '0021_post_creation_idempotency.sql',
  '0022_revoked_attachment_hashes.sql',
  '0023_post_archive_deleted_by.sql',
  '0024_idempotency_fingerprints_and_attachment_sources.sql',
  '0025_attachment_gif_identity.sql'
)
ORDER BY name;
