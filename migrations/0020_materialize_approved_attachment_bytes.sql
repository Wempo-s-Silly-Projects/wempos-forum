-- Migration 0020: materialize bytes for legacy approved duplicate attachments.
-- Older versions approved hash-matching attachment rows without storing their
-- own chunks, relying on another attachment or marketplace GIF as the canonical
-- byte source. That source can later be deleted, which would break the alias.
-- Copy from an approved attachment with bytes first; if none exists, copy from
-- an approved GIF. Each target has a distinct attachment id and chunk ownership.

INSERT INTO attachment_chunks (attachment_id, kind, seq, data)
SELECT target.id, 'approved', source_chunk.seq, source_chunk.data
FROM attachments AS target
JOIN attachments AS source ON source.id = (
  SELECT candidate.id
  FROM attachments AS candidate
  WHERE candidate.hash = target.hash
    AND candidate.status = 'approved'
    AND candidate.id <> target.id
    AND EXISTS (
      SELECT 1 FROM attachment_chunks AS existing
      WHERE existing.attachment_id = candidate.id AND existing.kind = 'approved'
    )
  ORDER BY candidate.created_at ASC, candidate.id ASC
  LIMIT 1
)
JOIN attachment_chunks AS source_chunk
  ON source_chunk.attachment_id = source.id AND source_chunk.kind = 'approved'
WHERE target.status = 'approved'
  AND target.hash <> ''
  AND NOT EXISTS (
    SELECT 1 FROM attachment_chunks AS own
    WHERE own.attachment_id = target.id AND own.kind = 'approved'
  );
