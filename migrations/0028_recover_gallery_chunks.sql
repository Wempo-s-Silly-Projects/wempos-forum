-- Migration 0028: recover Gallery chunks where an approved attachment with
-- the same content hash still has the exact approved bytes. This repairs the
-- recoverable subset of older Gallery rows whose chunk data was lost; rows
-- without a matching attachment remain untouched and can be restored by
-- re-uploading the original image (the upload route repairs missing chunks).
INSERT INTO gif_chunks (gif_id, seq, data)
SELECT g.id, ac.seq, ac.data
FROM gifs g
JOIN attachments a
  ON a.hash = g.hash
 AND a.status = 'approved'
 AND a.id = (
   SELECT a2.id
   FROM attachments a2
   WHERE a2.hash = g.hash
     AND a2.status = 'approved'
     AND EXISTS (
       SELECT 1
       FROM attachment_chunks ac2
       WHERE ac2.attachment_id = a2.id
         AND ac2.kind = 'approved'
     )
   ORDER BY a2.created_at ASC, a2.id ASC
   LIMIT 1
 )
JOIN attachment_chunks ac
  ON ac.attachment_id = a.id
 AND ac.kind = 'approved'
WHERE g.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM gif_chunks existing WHERE existing.gif_id = g.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM revoked_attachment_hashes r WHERE r.hash = g.hash
  );
