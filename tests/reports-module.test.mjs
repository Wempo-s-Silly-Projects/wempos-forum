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
