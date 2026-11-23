
// Project Designer — experience/db
// Cursor and block-gate helpers adapted from Wempo's Forum.

// Validate SQL identifiers before interpolating them into SQL.
// SQL identifiers cannot be bound as query parameters.
function assertSqlIdentifier(value, name) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
  ) {
    throw new TypeError(`invalid SQL identifier: ${name}`);
  }
}

export function parseActivityCursor(raw) {
  if (typeof raw !== "string") return null;

  const rankedCursor = /^([01])_([0-9]{1,10})_([0-9]{1,10})/.exec(raw);
  if (
    rankedCursor &&
    rankedCursor[0].length === raw.length
  ) {
    return {
      rank: Number(rankedCursor[1]),
      seconds: Number(rankedCursor[2]),
      id: Number(rankedCursor[3]),
    };
  }

  const cursorMatch = /^([0-9]{1,10})_([0-9]{1,10})/.exec(raw);
  if (!cursorMatch || cursorMatch[0].length !== raw.length) {
    return null;
  }

  return {
    seconds: Number(cursorMatch[1]),
    id: Number(cursorMatch[2]),
  };
}

export function parseScoreCursor(raw) {
  if (typeof raw !== "string") return null;

  const cursorMatch = /^(-?[0-9]{1,10})_([0-9]{1,10})/.exec(raw);
  if (!cursorMatch || cursorMatch[0].length !== raw.length) {
    return null;
  }

  return {
    score: Number(cursorMatch[1]),
    id: Number(cursorMatch[2]),
  };
}

export function encodeActivityCursor(row) {
  return (
    (row.pinned_at === null || row.pinned_at === undefined ? "1_" : "0_") +
    Number(row.last_activity_at) +
    "_" +
    Number(row.id)
  );
}

export function encodeScoreCursor(row) {
  return (
    Number(row.like_count) -
    Number(row.dislike_count) +
    "_" +
    Number(row.id)
  );
}

export function makeBlockGate({
  table = "blocks",
  blockerColumn = "blocker_id",
  blockedColumn = "blocked_id",
  staffRoles = ["owner", "admin"],
} = {}) {
  assertSqlIdentifier(table, "table");
  assertSqlIdentifier(blockerColumn, "blockerColumn");
  assertSqlIdentifier(blockedColumn, "blockedColumn");

  if (
    !Array.isArray(staffRoles) ||
    !staffRoles.every((role) => typeof role === "string")
  ) {
    throw new TypeError("staffRoles must be an array of strings");
  }

  async function blockPairExists(env, viewerId, otherId) {
    const row = await env.FORUM_DB.prepare(
      `SELECT 1 FROM ${table} WHERE (${blockerColumn} = ?1 AND ${blockedColumn} = ?2) ` +
      `OR (${blockerColumn} = ?2 AND ${blockedColumn} = ?1) LIMIT 1`,
    )
      .bind(Number(viewerId), Number(otherId))
      .first();

    return Boolean(row);
  }

  function blockFilterSql(column) {
    assertSqlIdentifier(column, "column");

    return (
      ` AND ${column} NOT IN (` +
      `SELECT ${blockedColumn} FROM ${table} WHERE ${blockerColumn} = ? ` +
      `UNION SELECT ${blockerColumn} FROM ${table} WHERE ${blockedColumn} = ?)`
    );
  }

  async function blockedIdList(env, viewerId) {
    const id = Number(viewerId);

    const result = await env.FORUM_DB.prepare(
      `SELECT ${blockedColumn} AS id FROM ${table} WHERE ${blockerColumn} = ?1 ` +
      `UNION SELECT ${blockerColumn} AS id FROM ${table} WHERE ${blockedColumn} = ?1`,
    )
      .bind(id)
      .all();

    return (result.results || []).map((row) => Number(row.id));
  }

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
