-- Post-rollout repair for attachment aliases created by old Worker instances
-- while migration 0020 and the Worker deployment were in flight.
-- Run only after the new Worker is live and old versions have drained. Safe to
-- rerun: it only copies from another approved attachment that owns approved bytes.
-- GIF library selections remain by-reference and are deliberately excluded.

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
