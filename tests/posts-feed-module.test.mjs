// Copyright 2026 YourLocalGoober
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.

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
