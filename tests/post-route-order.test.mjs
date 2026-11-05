// v4.0 route-order guard (plan 2, Task 1): handlePostRoutes dispatches
// through an ordered handler array — first match wins — so the order IS the
// API contract. The composer in the later split tasks must assemble this
// exact sequence from the split modules; this pin makes any drift fail here
// instead of silently reordering which handler claims a route.
import test from "node:test";
import assert from "node:assert/strict";
import { POST_ROUTE_HANDLERS } from "../api/posts.mjs";

test("post route dispatch order is pinned", () => {
  assert.deepEqual(
    POST_ROUTE_HANDLERS.map((handler) => handler.name),
    [
      "handlePostFeedRoute",
      "handleRepliesReadRoute",
      "handlePostDetailRoute",
      "handleReplyCreateRoute",
      "handlePostCreateRoute",
      "handlePostEditRoute",
      "handlePostEditHistoryRoute",
      "handlePostDeleteRoute",
      "handleReactionRoute",
      "handleReactionDeleteRoute",
      "handleSuggestionStatusRoute",
      "handleSearchRoute",
    ],
  );
});
