-- Suggestion statuses (v3.1): suggestion threads can be marked resolved or
-- declined by staff (admins/owner) through POST /api/posts/:id/suggestion-status;
-- reopening clears all three columns. The status is display-only chip data —
-- decided_by/decided_at ride along for accountability.
--
-- Categories (v3.1, Discourse-style) need NO migration of their own:
-- posts.board is handler-whitelisted TEXT (SQLite cannot gain a CHECK via
-- ALTER TABLE ADD COLUMN), the new slugs (game-dev, showcase, help, updates)
-- join general/suggestions in api/posts.mjs's BOARD_VALUES, and every
-- pre-existing row already reads 'general' — the old posts land in the
-- General category automatically.
ALTER TABLE posts ADD COLUMN suggestion_status TEXT
  CHECK (suggestion_status IS NULL OR suggestion_status IN ('resolved', 'declined'));
ALTER TABLE posts ADD COLUMN suggestion_decided_by INTEGER;
ALTER TABLE posts ADD COLUMN suggestion_decided_at INTEGER;
