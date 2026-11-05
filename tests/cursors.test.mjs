// Composite pagination cursors (v4.0 plan 2, Task 1): the three shapes the
// feed walks — ranked activity (pinned rank + composite keyset), legacy 2-part
// activity (already-open tabs), and suggestions' signed score cursor — plus
// the two emitters. Bare-id cursors (mine=1, replies) stay inline at their
// call sites: their validators differ (mine allows 0, replies requires a
// positive id) and their error messages are route-specific.
//
// These tests encode the EXACT wire formats the browser holds:
//   activity: <rank>_<seconds>_<id>   (rank 0 = pinned block, 1 = unpinned)
//   legacy:   <seconds>_<id>
//   score:    <score>_<id>            (score may be negative)
import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeActivityCursor,
  encodeScoreCursor,
  parseActivityCursor,
  parseScoreCursor,
} from "../api/core/cursors.mjs";

test("parseActivityCursor: ranked, legacy, and rejecting shapes", () => {
  assert.deepEqual(parseActivityCursor("0_1234567890_42"), { rank: 0, seconds: 1234567890, id: 42 });
  assert.deepEqual(parseActivityCursor("1_1234567890_42"), { rank: 1, seconds: 1234567890, id: 42 });
  // Legacy 2-part cursor from an already-open tab: rank deliberately absent
  // (the feed branches on rank === undefined).
  const legacy = parseActivityCursor("1234567890_42");
  assert.deepEqual({ seconds: legacy.seconds, id: legacy.id }, { seconds: 1234567890, id: 42 });
  assert.equal(legacy.rank, undefined);
  // Ranks are only 0 or 1; seconds and id are digits only, ≤10 each.
  assert.equal(parseActivityCursor("2_123_42"), null);
  assert.equal(parseActivityCursor("1_abc_42"), null);
  assert.equal(parseActivityCursor("1_12345678901_42"), null);
  assert.equal(parseActivityCursor("1_123_"), null);
  assert.equal(parseActivityCursor(""), null);
  assert.equal(parseActivityCursor(null), null);
  assert.equal(parseActivityCursor("garbage"), null);
});

test("parseScoreCursor: signed score half, rejecting shapes", () => {
  assert.deepEqual(parseScoreCursor("-3_12"), { score: -3, id: 12 });
  assert.deepEqual(parseScoreCursor("0_12"), { score: 0, id: 12 });
  assert.deepEqual(parseScoreCursor("9999999999_1"), { score: 9999999999, id: 1 });
  assert.equal(parseScoreCursor("3.5_1"), null);
  assert.equal(parseScoreCursor("+3_1"), null);
  assert.equal(parseScoreCursor("_12"), null);
  assert.equal(parseScoreCursor("-3_"), null);
  assert.equal(parseScoreCursor("garbage"), null);
  assert.equal(parseScoreCursor(null), null);
});

test("encodeActivityCursor: the pinned half mirrors the leading ORDER BY key", () => {
  assert.equal(
    encodeActivityCursor({ pinned_at: null, last_activity_at: 123, id: 5 }),
    "1_123_5",
  );
  assert.equal(
    encodeActivityCursor({ pinned_at: undefined, last_activity_at: "123", id: "5" }),
    "1_123_5",
  );
  assert.equal(
    encodeActivityCursor({ pinned_at: 42, last_activity_at: 123, id: 5 }),
    "0_123_5",
  );
  assert.equal(encodeActivityCursor({ pinned_at: 0, last_activity_at: 7, id: 2 }), "0_7_2");
});

test("encodeScoreCursor: the score half is the row's own net tally", () => {
  assert.equal(encodeScoreCursor({ like_count: 3, dislike_count: 1, id: 7 }), "2_7");
  assert.equal(encodeScoreCursor({ like_count: 1, dislike_count: 3, id: 7 }), "-2_7");
  assert.equal(encodeScoreCursor({ like_count: 0, dislike_count: 0, id: 7 }), "0_7");
});
