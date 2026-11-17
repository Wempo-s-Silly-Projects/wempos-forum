// v4.0 core leaf: composite pagination cursors — wire formats the browser
// holds, so encode and parse are pinned by unit tests (tests/cursors.test.mjs
// pins the EXACT shapes through this leaf).
//
//   activity: <rank>_<seconds>_<id>  (rank 0 = pinned block, 1 = unpinned; a
//             missing rank is the legacy 2-part form an already-open tab may
//             still send) — walks (pinned, last_activity_at, id) keysets.
//   score:    <score>_<id> (signed) — walks the suggestions board's
//             (net score, id) keyset.
// Bare-id cursors (mine=1's `[0-9]{1,15}` and replies' `[1-9][0-9]{0,14}`)
// stay inline at their call sites: their validators differ by design and
// their error messages are route-specific.
//
// Phase-3 Kitskey migration: the codecs now LIVE in api/vendor/db.mjs
// (experience/db — byte-identical to the framework source, pinned by
// tests/vendor-parity.test.mjs); this leaf is the unchanged re-export seam so
// posts-feed.mjs and the tests keep importing exactly the way they did.
export {
  parseActivityCursor,
  parseScoreCursor,
  encodeActivityCursor,
  encodeScoreCursor,
} from "../vendor/db.mjs";
