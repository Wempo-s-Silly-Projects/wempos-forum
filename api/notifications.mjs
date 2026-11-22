// Copyright 2026 ItsWempo
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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Notification routes and the insert-batch pieces Task 5 spreads into the
// reply-insert transaction. Notification rows live in D1 (see
// migrations/0002_forum_v2.sql) and are recipient-only data throughout.
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { maskedExcerpt } from "./core/spoilers.mjs";
import { ACTIVE_BAN_SQL, VIEWABLE_POST_BINDS, viewablePostSql } from "./core/visibility.mjs";

const NOTIFICATIONS_PER_USER = 50;

// v5.40.0: per-kind notification preferences (migration 0068). The fixed
// allowlist of member-mutable kinds, one per creating path:
//   reply          notificationBatchStatements — a reply to your post/reply
//                  (replies.mjs, the MCP reply tool);
//   subscription   subscriptions.mjs — a reply in a thread you subscribed to;
//   mention        mentions.mjs — an @mention in a post or reply;
//   chat_mention   chat.mjs — an @mention in the lobby chat;
//   follow_thread  follows.mjs — a new thread from a member you follow;
//   invite_joined  invites.mjs — a friend joined with your invite link.
// Appeal outcomes (appeals.mjs, notifyStatement with no kind) are safety
// notices: never in this list, never mutable.
export const NOTIFICATION_KINDS = Object.freeze([
  "reply", "subscription", "mention", "chat_mention", "follow_thread", "invite_joined",
]);
const MAX_PREFS_ENTRIES = NOTIFICATION_KINDS.length * 4;

// "The recipient muted this kind", for an INSERT…SELECT's WHERE. The kind is
// an allowlist literal (never user text) so the predicate binds nothing;
// `recipientExpr` is a column or a "?" the caller binds itself. One PK probe.
export function mutedKindSql(recipientExpr, kind) {
  if (!NOTIFICATION_KINDS.includes(kind)) throw new Error("Unknown notification kind: " + kind);
  return "EXISTS (SELECT 1 FROM notification_prefs np WHERE np.user_id = " + recipientExpr +
    " AND instr(',' || np.muted || ',', '," + kind + ",') > 0)";
}

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
// v5.40.0: plus the recipient's mute for the path's kind, bound once more at
// the end (7 binds unlabelled, 8 labelled — fixed per statement).
const insertNotificationSql = (kind, withLabel) =>
  "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at" + (withLabel ? ", label" : "") + ") " +
    "SELECT ?, ?, ?, ?" + (withLabel ? ", ?" : "") + " WHERE NOT EXISTS (" +
    "SELECT 1 FROM notifications WHERE user_id = ? AND reply_id = ? LIMIT 1) AND NOT " + mutedKindSql("?", kind);

// The labelled variant (fix round C): the only fan-out source that
// self-describes is the mention scan — "You were mentioned by <username>".
// Everything else inserts with no label (NULL) and keeps the generic copy.
const INSERT_SQL_BY_KIND = Object.freeze(Object.fromEntries(NOTIFICATION_KINDS.map((kind) =>
  [kind, Object.freeze({ plain: insertNotificationSql(kind, false), labelled: insertNotificationSql(kind, true) })])));
const insertSqlFor = (kind) => {
  if (!Object.hasOwn(INSERT_SQL_BY_KIND, kind)) throw new Error("Unknown notification kind: " + kind);
  return INSERT_SQL_BY_KIND[kind];
};

const PRUNE_NOTIFICATIONS_SQL =
  "DELETE FROM notifications WHERE user_id = ? AND id NOT IN (" +
    "SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT " + NOTIFICATIONS_PER_USER + ")";

const NOTIFICATION_SELECT =
  "SELECT n.id, n.target_post_id, n.reply_id, n.created_at, n.read_at, n.label, " +
    "(SELECT body FROM posts WHERE id = n.reply_id) AS reply_body " +
  "FROM notifications n WHERE n.user_id = ? ORDER BY n.id DESC LIMIT " + NOTIFICATIONS_PER_USER;

// Member variant (staff read the plain one above so desk work never breaks):
// wave 40 gates the WHOLE row, not just the preview — a post-targeted row
// shows only while canViewPost would pass for the recipient (the reply, its
// parent and its root each public, author unbanned, no block pair either
// way). Its label ("You were mentioned by X") and the unread badge go with
// it; an unban/unblock restores the row with no write. Label-only rows
// (reply_id NULL: appeal outcomes, chat pings) always show.
// Bind order: recipient (list WHERE), then recipient x VIEWABLE_POST_BINDS.
//
// Wave 5.10: a lobby @mention row is label-only but NAMES its actor
// (chatMentionLabel). It drops while that member is actively banned or in a
// block pair with the recipient, read-time like every other row (an unban or
// unblock restores it). The actor resolves from the server-built label by
// username_key (an index probe); the pair check keys on n.user_id, so the
// filter adds no binds.
const CHAT_MENTION_PREFIX = "You were mentioned by ";
const CHAT_MENTION_SUFFIX = " in chat";
export const chatMentionLabel = (username) => CHAT_MENTION_PREFIX + username + CHAT_MENTION_SUFFIX;
// Wave 5.34: the invite-join row ("Your friend X joined using your invite
// link") names the new member the same way and drops under the same rule.
const INVITE_JOIN_PREFIX = "Your friend ";
const INVITE_JOIN_SUFFIX = " joined using your invite link";
export const inviteJoinLabel = (username) => INVITE_JOIN_PREFIX + username + INVITE_JOIN_SUFFIX;
// A label-only row that names its actor between `prefix` and `suffix` hides
// while that actor is actively banned or block-paired with the recipient.
const labelActorHiddenSql = (prefix, suffix) =>
  "(n.label LIKE '" + prefix + "%" + suffix + "' AND EXISTS (SELECT 1 FROM users au " +
  "WHERE au.username_key = lower(substr(n.label, " + (prefix.length + 1) + ", length(n.label) - " +
  (prefix.length + suffix.length) + ")) AND (" + ACTIVE_BAN_SQL("au.id") +
  " OR EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = n.user_id AND bk.blocked_id = au.id) " +
  "OR (bk.blocked_id = n.user_id AND bk.blocker_id = au.id)))))";
const CHAT_MENTION_ACTOR_HIDDEN_SQL = labelActorHiddenSql(CHAT_MENTION_PREFIX, CHAT_MENTION_SUFFIX);
const INVITE_JOIN_ACTOR_HIDDEN_SQL = labelActorHiddenSql(INVITE_JOIN_PREFIX, INVITE_JOIN_SUFFIX);
const MEMBER_ROW_FILTER =
  "((n.reply_id IS NULL AND NOT " + CHAT_MENTION_ACTOR_HIDDEN_SQL + " AND NOT " + INVITE_JOIN_ACTOR_HIDDEN_SQL + ") OR " + viewablePostSql("n.reply_id") + ")";
const NOTIFICATION_SELECT_FILTERED =
  "SELECT n.id, n.target_post_id, n.reply_id, n.created_at, n.read_at, n.label, " +
    "(SELECT body FROM posts WHERE id = n.reply_id) AS reply_body " +
  "FROM notifications n WHERE n.user_id = ? AND " + MEMBER_ROW_FILTER +
  " ORDER BY n.id DESC LIMIT " + NOTIFICATIONS_PER_USER;
const memberBinds = (userId) => [userId, ...Array(VIEWABLE_POST_BINDS).fill(userId)];
const isStaffRole = (role) => role === "owner" || role === "admin";

function publicNotification(row) {
  const hasTarget = row.target_post_id !== null && row.target_post_id !== undefined;
  return {
    id: Number(row.id),
    // NULL = a label-only notification (appeal outcome, chat ping): no post
    // target for the client to navigate to.
    targetPostId: hasTarget ? Number(row.target_post_id) : null,
    replyId: hasTarget ? Number(row.reply_id) : null,
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    read: row.read_at !== null && row.read_at !== undefined,
    // Wave 17: spoilers masked before the 80-char cut (output only).
    postPreview: maskedExcerpt(String(row.reply_body || ""), 80),
    // The fan-out source's own copy (mentions C2/fix round 1); null keeps the
    // generic reply copy. Only ever set by the server — user text reaches the
    // DOM through textContent in the renderer.
    label: row.label !== null && row.label !== undefined ? String(row.label) : null,
  };
}

function notificationBatchStatements(db, recipientId, replyAuthorId, targetPostId, replyId, now) {
  if (recipientId === null || Number(recipientId) === Number(replyAuthorId)) return [];
  return [
    db.prepare(insertSqlFor("reply").plain)
      .bind(recipientId, targetPostId, replyId, now, recipientId, replyId, recipientId),
    db.prepare(PRUNE_NOTIFICATIONS_SQL).bind(recipientId, recipientId),
  ];
}

// Statement builder shared by the other fan-out sources (subscriptions C1,
// mentions C2): one dedupe-guarded INSERT + one cap-pruning DELETE per unique,
// valid recipient — the exact notificationBatchStatements idiom spread over a
// list. Caller-side exclusions (reply author, ordinary target, self-mention)
// are applied BEFORE this runs; the INSERT's own NOT EXISTS guard remains the
// last line of defense against duplicate notifications for one (member, reply).
export function fanOutStatements(db, recipientIds, { targetPostId, replyId, now, label, kind }) {
  const hasLabel = typeof label === "string" && label.length > 0;
  if (hasLabel && label.length > 200) {
    // Labels are server-computed copy (never user text beyond the actor's own
    // 24-char username); a runaway label is a caller bug — refuse loudly.
    throw new HttpError(500, "Notification label too long.");
  }
  // v5.40.0: every fan-out names its kind; the INSERT skips a recipient who
  // muted it (an unknown kind is a caller bug and throws).
  const sqlForKind = insertSqlFor(kind);
  const insertSql = hasLabel ? sqlForKind.labelled : sqlForKind.plain;
  const statements = [];
  const seen = new Set();
  for (const rawId of recipientIds || []) {
    const recipientId = Number(rawId);
    if (!Number.isSafeInteger(recipientId) || recipientId < 1 || seen.has(recipientId)) continue;
    seen.add(recipientId);
    statements.push(
      hasLabel
        ? db.prepare(insertSql)
          .bind(recipientId, targetPostId, replyId, now, label, recipientId, replyId, recipientId)
        : db.prepare(insertSql)
          .bind(recipientId, targetPostId, replyId, now, recipientId, replyId, recipientId),
      db.prepare(PRUNE_NOTIFICATIONS_SQL).bind(recipientId, recipientId),
    );
  }
  return statements;
}

// A label-only notification (v4.2): the row has NO post target — appeal
// outcomes, chat/DM pings — so there is no reply-dedupe guard (it keys on
// reply_id, which is NULL here). Labels are server-computed copy, capped like
// every other label. v5.40.0: a `kind` from NOTIFICATION_KINDS makes the row
// mutable (the recipient's mute is checked in the same statement); no kind =
// a safety notice (appeal outcomes) that always lands.
function notifyStatement(db, userId, label, kind = null) {
  const capped = String(label).slice(0, 200);
  if (kind === null) {
    return db.prepare(
      "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) " +
        "VALUES (?, NULL, NULL, ?, ?)",
    ).bind(userId, nowSeconds(), capped);
  }
  return db.prepare(
    "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) " +
      "SELECT ?, NULL, NULL, ?, ? WHERE NOT " + mutedKindSql("?", kind),
  ).bind(userId, nowSeconds(), capped, userId);
}

// Stored list -> allowlist order, unknown entries dropped (a kind retired in
// a later version simply stops counting).
const parseMuted = (stored) => {
  const entries = new Set(String(stored ?? "").split(","));
  return NOTIFICATION_KINDS.filter((kind) => entries.has(kind));
};

// PUT body -> the validated list, or a 400. Strict: an array of exact
// allowlist strings (case and whitespace count), bounded length.
function validMuted(body) {
  const muted = body?.muted;
  if (!Array.isArray(muted) || muted.length > MAX_PREFS_ENTRIES) {
    throw new HttpError(400, "Send the list of notification kinds to mute.");
  }
  for (const kind of muted) {
    if (typeof kind !== "string" || !NOTIFICATION_KINDS.includes(kind)) {
      throw new HttpError(400, "That notification kind is not one you can mute.");
    }
  }
  return NOTIFICATION_KINDS.filter((kind) => muted.includes(kind));
}

async function readPrefs(env, userId) {
  const row = await env.FORUM_DB.prepare("SELECT muted FROM notification_prefs WHERE user_id = ? LIMIT 1")
    .bind(userId).first();
  return { kinds: [...NOTIFICATION_KINDS], muted: parseMuted(row?.muted) };
}

// GET/PUT /api/me/notification-prefs: own row only. Writes are signed in +
// CSRF (requireUser), not banned, and on the write rate limit tier.
async function handleNotificationPrefsRoute(request, env, method) {
  if (method === "GET") {
    const user = await requireSignedInRead(request, env);
    return json(await readPrefs(env, Number(user.user.id)));
  }
  if (method !== "PUT") throw new HttpError(405, "That method is not supported.");
  const session = await requireUser(request, env);
  const userId = Number(session.user.id);
  await assertNotBanned(env, userId);
  await rateLimit(request, env, "write", String(userId));
  const muted = validMuted(await readJson(request));
  await env.FORUM_DB.prepare(
    "INSERT INTO notification_prefs (user_id, muted, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET muted = excluded.muted, updated_at = excluded.updated_at",
  ).bind(userId, muted.join(","), nowSeconds()).run();
  return json({ kinds: [...NOTIFICATION_KINDS], muted });
}

// The unread badge: the same rows the list shows (wave 40) — staff count
// every row, members only the rows MEMBER_ROW_FILTER keeps.
async function unreadCount(env, userId, role = null) {
  const row = await (isStaffRole(role)
    ? env.FORUM_DB.prepare(
      "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL",
    ).bind(userId)
    : env.FORUM_DB.prepare(
      "SELECT COUNT(*) AS unread FROM notifications n WHERE n.user_id = ? AND " + MEMBER_ROW_FILTER +
      " AND n.read_at IS NULL",
    ).bind(...memberBinds(userId))).first();
  return row ? Number(row.unread) : 0;
}

async function handleNotificationsRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;

  if (path === "/api/me/notification-prefs") return handleNotificationPrefsRoute(request, env, method);

  if (path === "/api/me/notifications") {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    const user = await requireSignedInRead(request, env);
    const result = await (isStaffRole(user.user.role)
      ? db.prepare(NOTIFICATION_SELECT).bind(user.user.id)
      : db.prepare(NOTIFICATION_SELECT_FILTERED).bind(...memberBinds(user.user.id))
    ).all();
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

  // v4.21: a grouped thread row on the page marks every label-less reply
  // notification for that thread read at once. Own rows only; labelled rows
  // (mentions, appeal outcomes) are their own items and stay as they are. The
  // inner LIMIT bounds the write (the per-member cap is 50 rows anyway).
  const readThread = path.match(/^\/api\/me\/notifications\/read-thread\/([0-9]+)$/);
  if (readThread) {
    if (method !== "POST") throw new HttpError(405, "That method is not supported.");
    const postId = Number(readThread[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) return null;
    const user = await requireUser(request, env);
    await db.prepare(
      "UPDATE notifications SET read_at = ? WHERE id IN (" +
        "SELECT id FROM notifications WHERE user_id = ? AND " +
        "target_post_id = ? AND read_at IS NULL AND label IS NULL LIMIT " + NOTIFICATIONS_PER_USER + ")",
    ).bind(nowSeconds(), user.user.id, postId).run();
    return json({ ok: true });
  }

  return null;
}

async function handleNotificationsRoutes(request, env, url, path, method) {
  return await handleNotificationsRoute(request, env, url, path, method);
}

export { notificationBatchStatements, unreadCount, handleNotificationsRoutes, notifyStatement };