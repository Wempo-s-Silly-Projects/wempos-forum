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

// Follow a member (v5.39.0 F2, migration 0067). POST/DELETE
// /api/users/:name/follow (signed in + CSRF, not banned, write limiter);
// GET answers the caller's own state; GET /api/me/following lists the
// caller's own follows. Follows are private: no count or list of anyone
// else's follows or followers is ever served.
//
// Refusals don't leak: following a missing member, an actively banned member
// or anyone across a block pair (either direction) answers the same 404.
// Following yourself is a 400 (it tells you nothing new).
//
// The fan-out: when a member starts a NEW PUBLIC ROOT thread, each follower
// gets one bell row, built as ONE INSERT ... SELECT (fixed binds, no IN list)
// capped at FOLLOW_FANOUT_CAP followers, earliest follow first. It skips
// banned followers, block pairs and anyone already holding a row for the post
// (an @mention); the bell's read-time filter re-checks the post afterwards,
// so a later hide, ban or block drops the row with no write.
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { blockPairExists } from "./core/blocks.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit } from "./core/http.mjs";
import { userByUsernameKey } from "./core/shapers.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";
import { mutedKindSql, mutedThreadSql } from "./notifications.mjs";

export const FOLLOW_FANOUT_CAP = 500;
export const FOLLOWING_MAX = 200;
const NOTIFICATIONS_PER_USER = 50;
const FOLLOW_THREAD_PREFIX = "New thread from ";
export const followThreadLabel = (username) => FOLLOW_THREAD_PREFIX + username;

const notFound = () => new HttpError(404, "Member not found.");
const isStaff = (user) => user.role === "owner" || user.role === "admin";

const PAIR_SQL = (a, b) =>
  "EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = " + a + " AND bk.blocked_id = " + b + ") " +
  "OR (bk.blocker_id = " + b + " AND bk.blocked_id = " + a + "))";

// The eligible followers of one author, earliest first, capped. Binds: the
// followee id once. v5.40.0: a follower who muted follow_thread is not
// eligible (so muted members never use up the cap); the mute adds no binds.
const ELIGIBLE_FOLLOWERS_SQL =
  "SELECT f.follower_id FROM user_follows f WHERE f.followee_id = ? AND f.follower_id <> f.followee_id " +
  "AND NOT " + ACTIVE_BAN_SQL("f.follower_id") + " AND NOT " + PAIR_SQL("f.follower_id", "f.followee_id") +
  " AND NOT " + mutedKindSql("f.follower_id", "follow_thread") +
  " ORDER BY f.created_at ASC, f.follower_id ASC LIMIT " + FOLLOW_FANOUT_CAP;

// Binds (5) in text order: now, label, authorId (followers), postId,
// authorId (the post must be that author's own root).
const FANOUT_INSERT_SQL =
  "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) " +
  "SELECT e.follower_id, p.id, p.id, ?, ? FROM posts p JOIN (" + ELIGIBLE_FOLLOWERS_SQL +
  ") e WHERE p.id = ? AND p.author_id = ? AND p.parent_id IS NULL AND p.visibility = 'public' " +
  "AND NOT " + ACTIVE_BAN_SQL("p.author_id") +
  " AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = e.follower_id AND n.reply_id = p.id)" +
  // v5.46.0: a follower who muted this thread (migration 0071) is skipped;
  // the predicate keys on columns, so the binds stay at 5.
  " AND NOT " + mutedThreadSql("e.follower_id", "p.id");

// Keeps each notified follower's bell at its 50-row cap (the per-recipient
// prune every other fan-out runs, as one correlated statement). Binds (1).
const FANOUT_PRUNE_SQL =
  "DELETE FROM notifications WHERE user_id IN (" + ELIGIBLE_FOLLOWERS_SQL + ") AND id NOT IN (" +
  "SELECT n2.id FROM notifications n2 WHERE n2.user_id = notifications.user_id ORDER BY n2.id DESC LIMIT " +
  NOTIFICATIONS_PER_USER + ")";

// The two statements, spread into one batch by the post-create route.
export function followerFanOutStatements(db, { authorId, postId, username, now }) {
  const author = Number(authorId);
  return [
    db.prepare(FANOUT_INSERT_SQL)
      .bind(now, followThreadLabel(username), author, Number(postId), author),
    db.prepare(FANOUT_PRUNE_SQL).bind(author),
  ];
}

// Block (api/blocks.mjs): a new block removes the pair's follows both ways.
export const unfollowPairStatement = (db, a, b) => db.prepare(
  "DELETE FROM user_follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)",
).bind(a, b, b, a);

async function targetFrom(env, rawName) {
  let username;
  try {
    username = decodeURIComponent(rawName);
  } catch {
    throw notFound();
  }
  const user = await userByUsernameKey(env, username.toLowerCase());
  if (!user) throw notFound();
  return user;
}

async function isActivelyBanned(env, userId) {
  const row = await env.FORUM_DB.prepare("SELECT " + ACTIVE_BAN_SQL("?") + " AS banned").bind(userId).first();
  return Boolean(Number(row?.banned));
}

async function followState(env, followerId, followeeId) {
  const row = await env.FORUM_DB.prepare(
    "SELECT 1 AS hit FROM user_follows WHERE follower_id = ? AND followee_id = ? LIMIT 1",
  ).bind(followerId, followeeId).first();
  return Boolean(row);
}

async function follow(env, userId, target) {
  const targetId = Number(target.id);
  if (targetId === userId) throw new HttpError(400, "You cannot follow yourself.");
  if ((await isActivelyBanned(env, targetId)) || (await blockPairExists(env, userId, targetId))) throw notFound();
  if (await followState(env, userId, targetId)) return json({ following: true });
  const total = await env.FORUM_DB.prepare("SELECT COUNT(*) AS n FROM user_follows WHERE follower_id = ?")
    .bind(userId).first();
  if (Number(total?.n || 0) >= FOLLOWING_MAX) {
    throw new HttpError(400, "You can follow up to " + FOLLOWING_MAX + " members.");
  }
  // Wave 5.41 L2: the cap rides the INSERT too, so a request that raced past
  // the read above cannot store a follow beyond FOLLOWING_MAX.
  const inserted = await env.FORUM_DB.prepare(
    "INSERT INTO user_follows (follower_id, followee_id, created_at) SELECT ?, ?, ? " +
    "WHERE (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) < " + FOLLOWING_MAX + " ON CONFLICT DO NOTHING",
  ).bind(userId, targetId, nowSeconds(), userId).run();
  if (Number(inserted.meta?.changes) !== 1 && !(await followState(env, userId, targetId))) {
    throw new HttpError(400, "You can follow up to " + FOLLOWING_MAX + " members.");
  }
  return json({ following: true });
}

async function handleFollowRoute(request, env, path, method) {
  const match = path.match(/^\/api\/users\/([^/]+)\/follow$/);
  if (!match) return null;
  if (method === "GET") {
    const viewer = (await requireSignedInRead(request, env)).user;
    const target = await targetFrom(env, match[1]);
    const targetId = Number(target.id);
    if (!isStaff(viewer) && targetId !== viewer.id && (await blockPairExists(env, viewer.id, targetId))) throw notFound();
    return json({ following: await followState(env, viewer.id, targetId) });
  }
  if (method !== "POST" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await requireUser(request, env);
  const userId = Number(session.user.id);
  await assertNotBanned(env, userId);
  await rateLimit(request, env, "write", String(userId));
  const target = await targetFrom(env, match[1]);
  if (method === "POST") return follow(env, userId, target);
  await env.FORUM_DB.prepare("DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?")
    .bind(userId, Number(target.id)).run();
  return json({ following: false });
}

// The caller's own list: newest first, actively banned and block-paired
// followees drop at read time (an unban restores them with no write).
async function handleFollowingList(request, env) {
  const user = (await requireSignedInRead(request, env)).user;
  const rows = (await env.FORUM_DB.prepare(
    "SELECT u.id, u.username, f.created_at FROM user_follows f JOIN users u ON u.id = f.followee_id " +
    "WHERE f.follower_id = ? AND NOT " + ACTIVE_BAN_SQL("u.id") + " AND NOT " + PAIR_SQL("f.follower_id", "u.id") +
    " ORDER BY f.created_at DESC, u.id DESC LIMIT " + FOLLOWING_MAX,
  ).bind(user.id).all()).results || [];
  return json({
    following: rows.map((row) => ({
      id: Number(row.id),
      username: row.username,
      followedAt: new Date(Number(row.created_at) * 1000).toISOString(),
    })),
  });
}

export async function handleFollowRoutes(request, env, url, path, method) {
  if (path === "/api/me/following") {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    return handleFollowingList(request, env);
  }
  return handleFollowRoute(request, env, path, method);
}
