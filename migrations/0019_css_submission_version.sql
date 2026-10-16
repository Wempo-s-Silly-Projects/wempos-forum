ALTER TABLE users ADD COLUMN pending_css_version TEXT;

UPDATE users
SET pending_css_version = lower(hex(randomblob(16)))
WHERE pending_css IS NOT NULL AND css_status = 'pending';
