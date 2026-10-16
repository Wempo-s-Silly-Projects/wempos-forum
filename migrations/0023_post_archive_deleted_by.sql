-- Record the actor who caused each archived post to be removed.
-- Keep the name snapshot even if that account is later deleted; the FK is
-- intentionally nullable and SET NULL so account deletion cannot block.
ALTER TABLE post_archive ADD COLUMN deleted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE post_archive ADD COLUMN deleted_by_name TEXT;
-- Post-delete was author-only, so historical actor names are known. Account-delete
-- rows may include other members' replies, so their actor cannot be inferred.
UPDATE post_archive
SET deleted_by_name = author_name
WHERE deleted_because = 'post-delete' AND deleted_by_name IS NULL;

UPDATE post_archive
SET deleted_by_user_id = author_id
WHERE deleted_because = 'post-delete'
  AND deleted_by_user_id IS NULL
  AND EXISTS (SELECT 1 FROM users WHERE users.id = post_archive.author_id);
