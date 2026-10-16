-- View counter (v2.4.3, raw impressions): each detail read by a NON-author
-- adds one view. The count is display-only; it dies with the post (cascade)
-- and never affects sorting.
ALTER TABLE posts ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
