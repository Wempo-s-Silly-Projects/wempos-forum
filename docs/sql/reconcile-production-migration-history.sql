-- MANUAL RECOVERY ONLY. Never move this file into migrations/ and never run it in CI.
-- Requires a recoverable D1 backup and a successful review of
-- docs/sql/preflight-production-migration-history.sql against the intended database.
-- This script records only already-present schema effects for 0019 and 0021-0023.
-- It replays the idempotent 0020 backfill first. It does NOT apply 0024.
-- If the final ledger is incomplete, stop. Do not run Wrangler migrations yet.

-- 0019: record the existing nullable TEXT column only if its backfill invariant holds.
INSERT INTO d1_migrations (name)
SELECT '0019_css_submission_version.sql'
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0019_css_submission_version.sql')
  AND EXISTS (SELECT 1 FROM pragma_table_info('users')
    WHERE name = 'pending_css_version' AND type = 'TEXT' AND "notnull" = 0)
  AND NOT EXISTS (SELECT 1 FROM users WHERE pending_css IS NOT NULL
    AND css_status = 'pending' AND (pending_css_version IS NULL OR pending_css_version = ''));

-- 0020: safe, repeatable materialization. GIF-library references remain by-reference.
INSERT INTO attachment_chunks (attachment_id, kind, seq, data)
SELECT target.id, 'approved', source_chunk.seq, source_chunk.data
FROM attachments target
JOIN attachments source ON source.id = (
  SELECT candidate.id FROM attachments candidate
  WHERE candidate.hash = target.hash AND candidate.status = 'approved'
    AND candidate.id <> target.id
    AND EXISTS (SELECT 1 FROM attachment_chunks existing
      WHERE existing.attachment_id = candidate.id AND existing.kind = 'approved')
  ORDER BY candidate.created_at ASC, candidate.id ASC LIMIT 1
)
JOIN attachment_chunks source_chunk
  ON source_chunk.attachment_id = source.id AND source_chunk.kind = 'approved'
WHERE target.status = 'approved' AND target.hash <> ''
  AND NOT EXISTS (SELECT 1 FROM gifs g
    WHERE g.hash = target.hash AND g.status = 'approved')
  AND NOT EXISTS (SELECT 1 FROM attachment_chunks own
    WHERE own.attachment_id = target.id AND own.kind = 'approved')
  AND EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0019_css_submission_version.sql')
  AND NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0020_materialize_approved_attachment_bytes.sql');

INSERT INTO d1_migrations (name)
SELECT '0020_materialize_approved_attachment_bytes.sql'
WHERE EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0019_css_submission_version.sql')
  AND NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0020_materialize_approved_attachment_bytes.sql')
  AND EXISTS (SELECT 1 FROM pragma_table_info('attachments') WHERE name = 'hash')
  AND EXISTS (SELECT 1 FROM pragma_table_info('attachment_chunks') WHERE name = 'data')
  AND EXISTS (SELECT 1 FROM pragma_table_info('gifs') WHERE name = 'hash')
  AND NOT EXISTS (
    SELECT 1 FROM attachments target
    WHERE target.status = 'approved' AND target.hash <> ''
      AND NOT EXISTS (SELECT 1 FROM attachment_chunks own
        WHERE own.attachment_id = target.id AND own.kind = 'approved')
      AND NOT EXISTS (SELECT 1 FROM attachments source
        JOIN attachment_chunks chunks ON chunks.attachment_id = source.id AND chunks.kind = 'approved'
        WHERE source.status = 'approved' AND source.hash = target.hash AND source.id <> target.id)
      AND NOT EXISTS (SELECT 1 FROM gifs g WHERE g.hash = target.hash AND g.status = 'approved')
  );

-- 0021: schema fingerprint must include the same unique partial key index.
INSERT INTO d1_migrations (name)
SELECT '0021_post_creation_idempotency.sql'
WHERE EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0020_materialize_approved_attachment_bytes.sql')
  AND NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0021_post_creation_idempotency.sql')
  AND EXISTS (SELECT 1 FROM pragma_table_info('posts') WHERE name = 'idempotency_key' AND type = 'TEXT')
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index'
    AND name = 'idx_posts_author_idempotency_key'
    AND sql LIKE 'CREATE UNIQUE INDEX%' AND sql LIKE '%WHERE idempotency_key IS NOT NULL%');

-- 0022: record the hash tombstone table only if its expected columns exist.
INSERT INTO d1_migrations (name)
SELECT '0022_revoked_attachment_hashes.sql'
WHERE EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0021_post_creation_idempotency.sql')
  AND NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0022_revoked_attachment_hashes.sql')
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'revoked_attachment_hashes')
  AND EXISTS (SELECT 1 FROM pragma_table_info('revoked_attachment_hashes') WHERE name = 'hash' AND pk = 1)
  AND EXISTS (SELECT 1 FROM pragma_table_info('revoked_attachment_hashes')
    WHERE name = 'revoked_at' AND type = 'INTEGER' AND "notnull" = 1);

-- 0023: rerun only null-safe backfills; actor name snapshots are retained.
UPDATE post_archive SET deleted_by_name = author_name
WHERE deleted_because = 'post-delete' AND deleted_by_name IS NULL
  AND EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0022_revoked_attachment_hashes.sql');

UPDATE post_archive SET deleted_by_user_id = author_id
WHERE deleted_because = 'post-delete' AND deleted_by_user_id IS NULL
  AND EXISTS (SELECT 1 FROM users WHERE users.id = post_archive.author_id)
  AND EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0022_revoked_attachment_hashes.sql');

INSERT INTO d1_migrations (name)
SELECT '0023_post_archive_deleted_by.sql'
WHERE EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0022_revoked_attachment_hashes.sql')
  AND NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0023_post_archive_deleted_by.sql')
  AND EXISTS (SELECT 1 FROM pragma_table_info('post_archive')
    WHERE name = 'deleted_by_user_id' AND type = 'INTEGER')
  AND EXISTS (SELECT 1 FROM pragma_table_info('post_archive')
    WHERE name = 'deleted_by_name' AND type = 'TEXT')
  AND EXISTS (SELECT 1 FROM pragma_foreign_key_list('post_archive')
    WHERE "from" = 'deleted_by_user_id' AND "table" = 'users' AND on_delete = 'SET NULL');

SELECT name, applied_at FROM d1_migrations
WHERE name IN ('0019_css_submission_version.sql',
  '0020_materialize_approved_attachment_bytes.sql',
  '0021_post_creation_idempotency.sql',
  '0022_revoked_attachment_hashes.sql',
  '0023_post_archive_deleted_by.sql')
ORDER BY name;
