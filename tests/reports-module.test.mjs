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

// v4.0 plan 3, Task 4: the "who reviews" module — every queue. Post reports
// (create/queue/resolve), profile reports (create + admin, moved from
// profiles.mjs so both report families sit together per the spec), and the
// two ruled-in review-desk handlers: thread pin/unpin and the hidden-posts
// desk page. Moved verbatim (see plan-3 rulings in the plan doc).
import test from "node:test";
import assert from "node:assert/strict";
import * as reports from "../api/reports.mjs";

test("reports.mjs exports the review-desk surface", () => {
  for (const name of [
    "handleReportCreateRoute",
    "handleReportQueueRoute",
    "hidePostForOpenReport",
    "dismissOpenReport",
    "handleReportResolveRoute",
    "handleProfileReportRoute",
    "handleProfileReportAdminRoute",
    "handleThreadPinRoute",
    "handleHiddenPostsRoute",
  ]) {
    assert.equal(typeof reports[name], "function", `reports.mjs must export ${name}`);
  }
});
