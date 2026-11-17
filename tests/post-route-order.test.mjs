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
