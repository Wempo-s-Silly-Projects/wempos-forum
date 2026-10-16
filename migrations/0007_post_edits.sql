-- Edit history (v2.4.1): post_edits stores every PAST version of a post. The
-- API inserts the replaced body inside the same atomic batch as the edit's
-- UPDATE; the FIRST edit's snapshot is the original body stamped at creation,
-- so a post's full lineage is reconstructible from creation onward. History
-- lives only as long as the post: CASCADE on post deletion.
CREATE TABLE post_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  editor_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  edited_at INTEGER NOT NULL
);
CREATE INDEX idx_post_edits_post ON post_edits(post_id, edited_at);