// v4.0 plan 2, Task 3: the feed/detail read surface lives in api/posts-feed
// .mjs. This pin holds the module's export names steady across the split —
// the composer (posts.mjs) re-exports several of them (bookmarks.mjs imports
// banFilterSql, profiles.mjs imports listRootPosts), and replies.mjs will
// consume the decoration seam, so a dropped export fails here before it
// fails everywhere downstream.
import test from "node:test";
import assert from "node:assert/strict";
import * as feed from "../api/posts-feed.mjs";

test("posts-feed.mjs exports the feed/detail read surface", () => {
  for (const name of [
    "banFilterSql",
    "replySnippet",
    "replyCountsSql",
    "latestRepliesSql",
    "withAttachments",
    "withReplyMetadata",
    "listRootPosts",
    "listReplies",
    "handlePostFeedRoute",
    "handlePostDetailRoute",
    "attachSubReplyCounts",
  ]) {
    assert.equal(typeof feed[name], "function", `posts-feed.mjs must export ${name}`);
  }
  assert.equal(feed.REPLY_SNIPPET_MAX, 80);
});
