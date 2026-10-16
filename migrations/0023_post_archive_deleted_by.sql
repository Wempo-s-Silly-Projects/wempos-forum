-- Record the actor who caused each archived post to be removed.
-- Keep the name snapshot even if that account is later deleted; the FK is
-- intentionally nullable and SET NULL so account deletion cannot block.
ALTER TABLE post_archive ADD COLUMN deleted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE post_archive ADD COLUMN deleted_by_name TEXT;
