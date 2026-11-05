// v4.0 plan 2, Task 5: the write side of the posts surface — create (post +
// reply plumbing), edit, history, delete, and reactions — plus the idempotency
// family both create routes share and the SQL constants the real-SQLite FK
// tests (tests/deletions.test.mjs) import. This pin holds the module's export
// surface steady across the split; the composer re-exports several of these
// until the final sweep re-points importers.
import test from "node:test";
import assert from "node:assert/strict";
import * as write from "../api/posts-write.mjs";

test("posts-write.mjs exports the write surface", () => {
  for (const name of [
    "scheduleAttachmentVisionChecks",
    "getPostIdempotencyKey",
    "existingIdempotentPost",
    "throwIfArchivedIdempotencyKey",
    "storedPostFingerprint",
    "assertIdempotencyFingerprint",
    "replayIdempotentPost",
    "postCreationFingerprint",
    "persistStagedPostAttachments",
    "handlePostCreateRoute",
    "handlePostEditRoute",
    "handlePostEditHistoryRoute",
    "postDeletionStatements",
    "handlePostDeleteRoute",
    "handleReactionRoute",
    "handleReactionDeleteRoute",
  ]) {
    assert.equal(typeof write[name], "function", `posts-write.mjs must export ${name}`);
  }
  assert.equal(write.MAX_COMPOSER_BODY_CHARS, 1000);
  assert.equal(write.STAGED_IDEMPOTENCY_TTL_SECONDS, 30 * 60);
});

test("POST_DELETE_SQL and REPLY_REPARENT_SQL are the exact FK-test strings", () => {
  assert.equal(write.POST_DELETE_SQL, "DELETE FROM posts WHERE id = ? AND author_id = ?");
  assert.equal(write.REPLY_REPARENT_SQL, "UPDATE posts SET parent_id = ? WHERE parent_id = ?");
});
