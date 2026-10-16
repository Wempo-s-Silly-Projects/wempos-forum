-- Migration 0005 (author post edits): one nullable edited_at stamp on posts.
-- The edit route (PATCH /api/posts/:id, api/posts.mjs) sets it on the first and
-- every subsequent edit — a single value, no edit-history table. Edits are
-- deliberately NOT recorded in last_activity_at: an edit must never bump a
-- thread in the activity feed.
--
-- ALTER TABLE ADD COLUMN on a nullable column (no default) keeps the posts
-- table in place — no rebuild, no backfill, and every pre-migration row reads
-- as never-edited (NULL), which the serializers already normalize to null.

ALTER TABLE posts ADD COLUMN edited_at INTEGER;