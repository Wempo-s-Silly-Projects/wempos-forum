-- Migration 0006 (Suggestions board, v2.4.1): a board dimension on posts.
--
-- The board is a ROOT-ONLY dimension for now: root posts carry the board a
-- composer chose ('general' by default, 'suggestions' for the Suggestions
-- subforum), and replies inherit their thread root's board at creation so
-- board filtering can be a cheap column compare. The existing /api/posts feed
-- and every pre-migration row stay 'general' (the DEFAULT backfills all rows
-- in place — ALTER ADD COLUMN with NOT NULL DEFAULT never rebuilds the table).
--
-- Values are whitelisted at the handler layer (api/posts.mjs accepts only
-- 'general' and 'suggestions'); SQL cannot gain a CHECK via ALTER TABLE ADD
-- COLUMN, exactly like migration 0005's choice to let the edit route own its
-- invariants.

ALTER TABLE posts ADD COLUMN board TEXT NOT NULL DEFAULT 'general';