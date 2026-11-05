// v4.0 plan 2, Task 4: the reply routes (read page + reply creation) live in
// api/replies.mjs. It draws its decorations from posts-feed.mjs (the Task-3
// seam: listReplies, attachSubReplyCounts) and its shared creation plumbing
// from posts-write.mjs (the Task-5 ruling: idempotency family, staged
// persistence, scheduleAttachmentVisionChecks). This pin holds the module's
// export surface steady.
import test from "node:test";
import assert from "node:assert/strict";
import * as replies from "../api/replies.mjs";

test("replies.mjs exports the reply route handlers", () => {
  for (const name of ["handleRepliesReadRoute", "handleReplyCreateRoute"]) {
    assert.equal(typeof replies[name], "function", `replies.mjs must export ${name}`);
  }
});
