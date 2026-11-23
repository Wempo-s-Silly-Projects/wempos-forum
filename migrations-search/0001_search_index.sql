-- 0001_search_index.sql — the SEARCH_DB database (binding SEARCH_DB,
-- database wempo-forum-search), NOT the shared forum + Accounts database.
-- Applied with: wrangler d1 migrations apply wempo-forum-search
-- (migrations_dir = "migrations-search" on that d1_databases entry).
--
-- Keeping the FTS5 virtual table out of the shared database keeps the shared
-- database exportable with the standard `wrangler d1 export` (D1 cannot
-- export a database that holds a virtual table). This database holds only a
-- derived index: it can be deleted and rebuilt from the forum database at
-- any time (POST /api/search/backfill, owner only).
--
-- post_search: rowid = posts.id; body = the post body with spoilers already
-- masked, written only for posts that were publicly visible when indexed.
-- The read path re-checks the visibility law in the forum database for every
-- candidate, so a stale row can never show a hidden or banned post.
-- Tokenizer: unicode61 with remove_diacritics 2 ("cafe" finds "Café").
CREATE VIRTUAL TABLE IF NOT EXISTS post_search USING fts5(
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
