// v4.0 plan 2 composer (Task 7 shaping), final sweep applied: every route
// has split into boards.mjs, posts-feed.mjs, posts-write.mjs, replies.mjs,
// search.mjs, and suggestions.mjs; this module imports the handlers and
// composes the pinned POST_ROUTE_HANDLERS chain. (bookmarks.mjs and
// search.mjs import banFilterSql and profiles.mjs imports listRootPosts
// from posts-feed.mjs directly; the FK strings live on posts-write.mjs
// with their test.)
// v4.0 plan 2, Task 3: feed/detail reads moved to api/posts-feed.mjs.
import {
  handlePostDetailRoute,
  handlePostFeedRoute,
} from "./posts-feed.mjs";
// v4.0 plan 2, Task 6: search and suggestion-status moved to their modules.
import { handleSearchRoute } from "./search.mjs";
import { handleSuggestionStatusRoute } from "./suggestions.mjs";
// v4.0 plan 2, Task 5: the write routes + idempotency family + staged
// attachment persistence moved to api/posts-write.mjs (its surface is pinned
// by tests/posts-write-module.test.mjs; the composer re-exports several
// until the final sweep re-points importers).
import {
  POST_DELETE_SQL,
  REPLY_REPARENT_SQL,
  handlePostCreateRoute,
  handlePostDeleteRoute,
  handlePostEditHistoryRoute,
  handlePostEditRoute,
  handleReactionDeleteRoute,
  handleReactionRoute,
  postDeletionStatements,
} from "./posts-write.mjs";
// v4.0 plan 2, Task 4: the reply routes moved to api/replies.mjs.
import {
  handleRepliesReadRoute,
  handleReplyCreateRoute,
} from "./replies.mjs";
// The dispatch order IS the API contract (first handler claiming a route
// wins), so the chain lives here as an exported constant — tests/post-route-
// order.test.mjs pins the exact sequence, and the plan-2 split composer must
// assemble these same twelve from the split modules in this same order.
const POST_ROUTE_HANDLERS = [handlePostFeedRoute, handleRepliesReadRoute, handlePostDetailRoute, handleReplyCreateRoute, handlePostCreateRoute, handlePostEditRoute, handlePostEditHistoryRoute, handlePostDeleteRoute, handleReactionRoute, handleReactionDeleteRoute, handleSuggestionStatusRoute, handleSearchRoute];

async function handlePostRoutes(request, env, url, path, method, ctx) {
  const handlers = POST_ROUTE_HANDLERS;
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}

// The posts surface's public faces, in one place:
//   handlePostRoutes — the dispatcher worker.mjs mounts
//   POST_ROUTE_HANDLERS — the pinned chain (tests/post-route-order.test.mjs)
export {
  POST_ROUTE_HANDLERS,
  handlePostRoutes,
};
