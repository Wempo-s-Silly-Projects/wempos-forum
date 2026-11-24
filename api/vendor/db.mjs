// Project Designer — experience/db
// The guarded-SQL vocabulary, extracted from wempos-forum's api/core/
// (cursors.mjs, blocks.mjs — GC carries gc_-prefixed twins). The house
// idiom these capture:
//
//   - CURSORS are wire formats the browser holds: parse and encode are
//     pure, ANCHORED, and pinned by unit tests; a malformed cursor parses
//     to null so the route raises its own 400 (a leaked parse error is a
//     route bug, never a client-facing shape).
//   - THE BLOCK PAIR is the both-direction content wall: one row from
//     EITHER direction hides content between the pair everywhere. Detail
//     reads consult blockPairExists; LIST surfaces filter in the SELECT
//     via the fragment helpers (feeds filter rows, not per-row checks).
//     Staff never lose desk visibility — every read-path check bypasses
//     for staff viewers, so moderation can never be blocked.
//   - the D1 shape behind the surface is the app's env binding itself
//     (prepare().bind().first()/all()); Designer adds no wrapper layer —
//     tests fake it with the same three-method shape (see tests/), which
//     is exactly how every existing app test already fakes D1.
//
// No imports anywhere: pure SQL and pure string/number codecs, like the
// originals.

// --- cursors (verbatim from forum api/core/cursors.mjs) ---------------------

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

// The score half is signed — a thread disliked below zero sorts at a
// negative score, so its cursor can be "-3_12".
export function parseScoreCursor(raw) {
  if (typeof raw !== "string") return null;
  const cursorMatch = /^(-?[0-9]{1,10})_([0-9]{1,10})$/.exec(raw);
  if (!cursorMatch) return null;
  return { score: Number(cursorMatch[1]), id: Number(cursorMatch[2]) };
}

// The cursor's pinned rank mirrors the leading ORDER BY key: unpinned rows
// (rank 1) sort after the pinned block (rank 0). Row numbers are coerced so
// emitted cursors are always canonical wire text.
export function encodeActivityCursor(row) {
  return (row.pinned_at === null || row.pinned_at === undefined ? "1_" : "0_") +
    Number(row.last_activity_at) + "_" + Number(row.id);
}

// The score half comes from the row's own like/dislike counts — the
// identical tally the ORDER BY expression computes, so the emitted cursor
// always sorts exactly where the row was shown.
export function encodeScoreCursor(row) {
  return (Number(row.like_count) - Number(row.dislike_count)) + "_" + Number(row.id);
}

// --- the block gate ---------------------------------------------------------

// makeBlockGate: the blocks vocabulary, parameterized by the app's table
// (forum: "blocks"; GC: "gc_blocks") and its staff-read roles. Every helper
// keeps the original's behavior; only the table/role literals ride config.
//
//   staffRoles — the PUBLIC role values whose reads bypass the wall entirely
//                (forum/GC pair: ["owner", "admin"]). Stored-vocabulary
//                roles (the forum's frozen DB literals) must be mapped
//                public-side BEFORE reaching here, exactly as publicRole
//                already guarantees at every read path.
export function makeBlockGate({
  table = "blocks",
  blockerColumn = "blocker_id",
  blockedColumn = "blocked_id",
  staffRoles = ["owner", "admin"],
} = {}) {
  async function blockPairExists(env, viewerId, otherId) {
    const row = await env.FORUM_DB.prepare(
      `SELECT 1 FROM ${table} WHERE (${blockerColumn} = ?1 AND ${blockedColumn} = ?2) ` +
      `OR (${blockerColumn} = ?2 AND ${blockedColumn} = ?1) LIMIT 1`,
    ).bind(Number(viewerId), Number(otherId)).first();
    return Boolean(row);
  }

  // List-surface fragment: exclude every author (column) on either side of a
  // block pair with the viewer. Bound twice with the same id — D1's
  // positional binding makes the doubled bind the cheap, safe shape.
  function blockFilterSql(column) {
    return ` AND ${column} NOT IN (` +
      `SELECT ${blockedColumn} FROM ${table} WHERE ${blockerColumn} = ? ` +
      `UNION SELECT ${blockerColumn} FROM ${table} WHERE ${blockedColumn} = ?)`;
  }

  // The full both-direction block list for one member (GET /api/me/blocks).
  async function blockedIdList(env, viewerId) {
    const id = Number(viewerId);
    const result = await env.FORUM_DB.prepare(
      `SELECT ${blockedColumn} AS id FROM ${table} WHERE ${blockerColumn} = ?1 ` +
      `UNION SELECT ${blockerColumn} AS id FROM ${table} WHERE ${blockedColumn} = ?1`,
    ).bind(id).all();
    return (result.results || []).map((row) => Number(row.id));
  }

  // Viewer-scoped list clause: empty for guests (nothing to filter) and for
  // staff (their reads bypass, mirroring the detail-read gate). Every caller
  // of blockFilterSql goes through here so desk review can never be blocked.
  function viewerBlockFilterSql(viewer, column) {
    if (!viewer || !viewer.id) return "";
    if (staffRoles.includes(viewer.role)) return "";
    return blockFilterSql(column);
  }

  return {
    blockPairExists,
    blockFilterSql,
    blockedIdList,
    viewerBlockFilterSql,
  };
}
