-- Read-only post-rollout audit. Expected result: zero rows.
-- Rows returned are approved attachment records that have no owned approved
-- chunks, no other approved attachment source with chunks, and no approved GIF
-- with the same hash. Investigate and repair these individually before closing
-- the release; do not infer that a GIF-matching row is an upload alias.

SELECT target.id, target.post_id, target.hash, target.created_at
FROM attachments AS target
WHERE target.status = 'approved'
  AND target.hash <> ''
  AND NOT EXISTS (
    SELECT 1 FROM attachment_chunks AS own
    WHERE own.attachment_id = target.id AND own.kind = 'approved'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM attachments AS source
    JOIN attachment_chunks AS chunks
      ON chunks.attachment_id = source.id AND chunks.kind = 'approved'
    WHERE source.status = 'approved'
      AND source.hash = target.hash
      AND source.id <> target.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM gifs AS library_gif
    WHERE library_gif.hash = target.hash AND library_gif.status = 'approved'
  )
ORDER BY target.created_at ASC, target.id ASC;
