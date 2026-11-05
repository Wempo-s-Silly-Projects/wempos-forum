// v4.0 core leaf: composite pagination cursors — wire formats the browser
// holds, so encode and parse are pinned by unit tests. Imports nothing.
//
//   activity: <rank>_<seconds>_<id>  (rank 0 = pinned block, 1 = unpinned; a
//             missing rank is the legacy 2-part form an already-open tab may
//             still send) — walks (pinned, last_activity_at, id) keysets.
//   score:    <score>_<id> (signed) — walks the suggestions board's
//             (net score, id) keyset.
// Bare-id cursors (mine=1's `[0-9]{1,15}` and replies' `[1-9][0-9]{0,14}`)
// stay inline at their call sites: their validators differ by design and
// their error messages are route-specific.

// Accepts the ranked 3-part form and the legacy 2-part form; returns null
// for anything else (callers translate that into their own 400).
export function parseActivityCursor(raw) {
  if (typeof raw !== "string") return null;
  const rankedCursor = /^([01])_([0-9]{1,10})_([0-9]{1,10})$/.exec(raw);
  const cursorMatch = /^([0-9]{1,10})_([0-9]{1,10})$/.exec(raw);
  if (rankedCursor) {
    return { rank: Number(rankedCursor[1]), seconds: Number(rankedCursor[2]), id: Number(rankedCursor[3]) };
  }
  if (cursorMatch) {
    return { seconds: Number(cursorMatch[1]), id: Number(cursorMatch[2]) };
  }
  return null;
}

// Suggestions score cursor: the score half is signed — a thread disliked
// below zero sorts at a negative score, so its cursor can be "-3_12".
export function parseScoreCursor(raw) {
  if (typeof raw !== "string") return null;
  const cursorMatch = /^(-?[0-9]{1,10})_([0-9]{1,10})$/.exec(raw);
  if (!cursorMatch) return null;
  return { score: Number(cursorMatch[1]), id: Number(cursorMatch[2]) };
}

// The cursor's pinned rank mirrors the leading ORDER BY key: unpinned rows
// (rank 1) sort after the pinned block (rank 0). Coerces the row's numbers
// so emitted cursors are always canonical wire text.
export function encodeActivityCursor(row) {
  return (row.pinned_at === null || row.pinned_at === undefined ? "1_" : "0_") +
    Number(row.last_activity_at) + "_" + Number(row.id);
}

// The score half comes from the row's own like/dislike counts — the identical
// tally the ORDER BY expression computes, so the emitted cursor always sorts
// exactly where the row was shown.
export function encodeScoreCursor(row) {
  return (Number(row.like_count) - Number(row.dislike_count)) + "_" + Number(row.id);
}
