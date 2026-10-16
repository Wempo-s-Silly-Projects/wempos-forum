// Notification routes and the insert-batch pieces Task 5 spreads into the
// reply-insert transaction. Notification rows live in D1 (see
// migrations/0002_forum_v2.sql) and are recipient-only data throughout.
import {
  HttpError,
  json,
  nowSeconds,
  requireSignedInRead,
  requireUser,
} from "./shared.mjs";

const NOTIFICATIONS_PER_USER = 50;

// Statements ready to spread into the reply-insert D1 batch. Empty when there
// is no recipient (no author row to notify) or the reply author would be
// notified about their own reply.
//
// The insert's SELECT guard ("author guard") is interpreted here as a
// per-(recipient, reply_id) dedupe: the insert runs inside the same batch as
// the reply INSERT itself, whose guarded SELECT already verifies the target
// post and the unbanned author, so the residual risk this guard addresses is
// the duplicate notification row (batch retries / accidental double fans).
// The dedupe also keeps unreadCount from double counting one reply.
const INSERT_NOTIFICATION_SQL =
  "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at) " +
    "SELECT ?, ?, ?, ? WHERE NOT EXISTS (" +
    "SELECT 1 FROM notifications WHERE user_id = ? AND reply_id = ? LIMIT 1)";

// The labelled variant (fix round C): the only fan-out source that
// self-describes is the mention scan — "You were mentioned by <username>".
// Everything else inserts with no label (NULL) and keeps the generic copy.
const INSERT_NOTIFICATION_WITH_LABEL_SQL =
  "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) " +
    "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
    "SELECT 1 FROM notifications WHERE user_id = ? AND reply_id = ? LIMIT 1)";

const PRUNE_NOTIFICATIONS_SQL =
  "DELETE FROM notifications WHERE user_id = ? AND id NOT IN (" +
    "SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT " + NOTIFICATIONS_PER_USER + ")";

const NOTIFICATION_SELECT =
  "SELECT n.id, n.target_post_id, n.reply_id, n.created_at, n.read_at, n.label, " +
    "(SELECT body FROM posts WHERE id = n.reply_id) AS reply_body " +
  "FROM notifications n WHERE n.user_id = ? ORDER BY n.id DESC LIMIT " + NOTIFICATIONS_PER_USER;

function publicNotification(row) {
  return {
    id: Number(row.id),
    targetPostId: Number(row.target_post_id),
    replyId: Number(row.reply_id),
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    read: row.read_at !== null && row.read_at !== undefined,
    postPreview: String(row.reply_body || "").slice(0, 80),
    // The fan-out source's own copy (mentions C2/fix round 1); null keeps the
    // generic reply copy. Only ever set by the server — user text reaches the
    // DOM through textContent in the renderer.
    label: row.label !== null && row.label !== undefined ? String(row.label) : null,
  };
}

function notificationBatchStatements(db, recipientId, replyAuthorId, targetPostId, replyId, now) {
  if (recipientId === null || Number(recipientId) === Number(replyAuthorId)) return [];
  return [
    db.prepare(INSERT_NOTIFICATION_SQL)
      .bind(recipientId, targetPostId, replyId, now, recipientId, replyId),
    db.prepare(PRUNE_NOTIFICATIONS_SQL).bind(recipientId, recipientId),
  ];
}

// Statement builder shared by the other fan-out sources (subscriptions C1,
// mentions C2): one dedupe-guarded INSERT + one cap-pruning DELETE per unique,
// valid recipient — the exact notificationBatchStatements idiom spread over a
// list. Caller-side exclusions (reply author, ordinary target, self-mention)
// are applied BEFORE this runs; the INSERT's own NOT EXISTS guard remains the
// last line of defense against duplicate notifications for one (member, reply).
export function fanOutStatements(db, recipientIds, { targetPostId, replyId, now, label }) {
  const hasLabel = typeof label === "string" && label.length > 0;
  if (hasLabel && label.length > 200) {
    // Labels are server-computed copy (never user text beyond the actor's own
    // 24-char username); a runaway label is a caller bug — refuse loudly.
    throw new HttpError(500, "Notification label too long.");
  }
  const insertSql = hasLabel ? INSERT_NOTIFICATION_WITH_LABEL_SQL : INSERT_NOTIFICATION_SQL;
  const statements = [];
  const seen = new Set();
  for (const rawId of recipientIds || []) {
    const recipientId = Number(rawId);
    if (!Number.isSafeInteger(recipientId) || recipientId < 1 || seen.has(recipientId)) continue;
    seen.add(recipientId);
    statements.push(
      hasLabel
        ? db.prepare(insertSql)
          .bind(recipientId, targetPostId, replyId, now, label, recipientId, replyId)
        : db.prepare(insertSql)
          .bind(recipientId, targetPostId, replyId, now, recipientId, replyId),
      db.prepare(PRUNE_NOTIFICATIONS_SQL).bind(recipientId, recipientId),
    );
  }
  return statements;
}

async function unreadCount(env, userId) {
  const row = await env.FORUM_DB.prepare(
    "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL",
  ).bind(userId).first();
  return row ? Number(row.unread) : 0;
}

async function handleNotificationsRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;

  if (path === "/api/me/notifications") {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    const user = await requireSignedInRead(request, env);
    const result = await db.prepare(NOTIFICATION_SELECT).bind(user.user.id).all();
    return json({ notifications: (result.results || []).map(publicNotification) });
  }

  const readOne = path.match(/^\/api\/me\/notifications\/([0-9]+)\/read$/);
  if (readOne) {
    if (method !== "POST") throw new HttpError(405, "That method is not supported.");
    const user = await requireUser(request, env);
    const id = Number(readOne[1]);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    // Own rows only; a 0-change update (missing, foreign, or already read)
    // still succeeds so the endpoint is idempotent.
    await db.prepare(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
    ).bind(nowSeconds(), id, user.user.id).run();
    return json({ ok: true });
  }

  if (path === "/api/me/notifications/read-all") {
    if (method !== "POST") throw new HttpError(405, "That method is not supported.");
    const user = await requireUser(request, env);
    await db.prepare(
      "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
    ).bind(nowSeconds(), user.user.id).run();
    return json({ ok: true });
  }

  return null;
}

async function handleNotificationsRoutes(request, env, url, path, method) {
  return await handleNotificationsRoute(request, env, url, path, method);
}

export { notificationBatchStatements, unreadCount, handleNotificationsRoutes };