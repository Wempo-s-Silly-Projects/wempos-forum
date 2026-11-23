-- 0097_search.sql (the search module; docs/modules.md, api/full-search.mjs).
-- CREATE-only: no existing table is altered, nothing is dropped, no row of an
-- existing table is written.
--
-- post_search: an FTS5 index of every post body, keyed by rowid = posts.id.
-- It indexes every post whatever its visibility: the visibility law is
-- applied at READ time (public only, no actively banned author, every
-- ancestor viewable, no block pair), so hiding, unhiding, a ban or its expiry
-- needs no index write and an unban restores results on its own.
--
-- It is a regular (content-storing) FTS5 table, not external-content: a
-- delete by rowid of a post that was never indexed (the backfill has not
-- reached it yet) is a harmless no-op here, where an external-content
-- 'delete' with stale values would corrupt the index.
--
-- Tokenizer: unicode61 with remove_diacritics 2 (D1 ships FTS5 with the
-- built-in tokenizers), so "cafe" finds "Café" in every script unicode61
-- splits on.
CREATE VIRTUAL TABLE IF NOT EXISTS post_search USING fts5(
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Sync triggers. They read posts and write only post_search: they add no
-- column and change no existing table. They also fire on ON DELETE CASCADE
-- (a deleted account, a deleted thread), so no copy of deleted text stays in
-- the index. Rows written before this migration are indexed by the owner's
-- batched backfill (POST /api/search/backfill), which skips rows already
-- present, so it is idempotent and safe to repeat.
CREATE TRIGGER IF NOT EXISTS post_search_after_insert AFTER INSERT ON posts BEGIN
  INSERT INTO post_search (rowid, body) VALUES (new.id, new.body);
END;

CREATE TRIGGER IF NOT EXISTS post_search_after_delete AFTER DELETE ON posts BEGIN
  DELETE FROM post_search WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS post_search_after_update AFTER UPDATE OF body ON posts BEGIN
  DELETE FROM post_search WHERE rowid = old.id;
  INSERT INTO post_search (rowid, body) VALUES (new.id, new.body);
END;
