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

// Group DMs (v4.7, migration 0044): conversations of up to
// DM_GROUP_MAX_MEMBERS members including the creator. The creator (while
// still a member) adds and removes; anyone leaves, and the last member out
// deletes the group. Outsiders get the SAME 404 as a missing group — no
// existence oracle. Reads follow the visibility law: messages by actively-
// banned authors and by anyone in a block pair with the viewer are hidden at
// read time (no writes, so an unban or unblock restores them). Membership
// refuses banned members and any block pair inside the group.
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { DM_MAX_BODY_CHARS, dmMessageShape, isoTime } from "./chat.mjs";
import { DM_GROUP_MAX_MEMBERS, DM_GROUP_NAME_MAX_CHARS, DM_IMAGE_TOKEN_PATTERN } from "../constants.mjs";

const GROUP_MESSAGE_PAGE_LIMIT = 50;
const GROUP_PREVIEW_MAX_CHARS = 80;
const GROUP_ROUTE = /^\/api\/dm\/groups\/([0-9]{1,15})$/;
const GROUP_READ_MARK_ROUTE = /^\/api\/dm\/groups\/([0-9]{1,15})\/read$/;
const GROUP_LEAVE_ROUTE = /^\/api\/dm\/groups\/([0-9]{1,15})\/leave$/;
const GROUP_MEMBERS_ROUTE = /^\/api\/dm\/groups\/([0-9]{1,15})\/members$/;
const GROUP_MEMBER_ROUTE = /^\/api\/dm\/groups\/([0-9]{1,15})\/members\/([0-9]{1,15})$/;
const NOT_AVAILABLE = "That conversation does not exist.";

// Active-ban predicate keyed on any user-id column (expired/revoked bans
// don't count) — the wall's predicate, parameterized by column.
export const activeBanSql = (column) =>
  "EXISTS (SELECT 1 FROM bans b WHERE b.user_id = " + column +
  " AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
  "CAST(strftime('%s','now') AS INTEGER)))";

// Both-direction block pair between the bound viewer id (bound twice) and a
// column.
const blockPairSql = (column) =>
  "EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = ? AND bk.blocked_id = " + column +
  ") OR (bk.blocked_id = ? AND bk.blocker_id = " + column + "))";

const VISIBLE_GROUP_MESSAGE_SQL = "NOT " + activeBanSql("m.user_id") + " AND NOT " + blockPairSql("m.user_id");

const MEMBER_ROWS_SQL =
  "SELECT gm.group_id, u.id, u.username, u.role FROM dm_group_members gm " +
  "JOIN users u ON u.id = gm.user_id WHERE NOT " + activeBanSql("u.id");

const shapeMember = (row) => ({ id: Number(row.id), username: row.username, role: publicRole(row.role) });

// The group row when the viewer is a member; one 404 otherwise (missing and
// not-a-member are indistinguishable). Exported for the DM image routes.
export async function loadGroupForMember(env, groupId, viewerId) {
  const row = await env.FORUM_DB.prepare(
    "SELECT g.id, g.name, g.creator_id, gm.unread FROM dm_groups g " +
    "JOIN dm_group_members gm ON gm.group_id = g.id AND gm.user_id = ? WHERE g.id = ? LIMIT 1",
  ).bind(viewerId, groupId).first();
  if (!row) throw new HttpError(404, NOT_AVAILABLE);
  return row;
}

// The insert + unread bump pair for one group message, for a caller's batch:
// every OTHER member's counter moves; the sender's stays put.
export function groupMessageStatements(db, groupId, userId, body, now) {
  return [
    db.prepare("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
      .bind(groupId, userId, body, now),
    db.prepare("UPDATE dm_group_members SET unread = unread + 1 WHERE group_id = ? AND user_id <> ?")
      .bind(groupId, userId),
  ];
}

// The signed-in member's groups for GET /api/dm/threads: newest activity
// first, the preview honoring the same ban/block hiding as the read.
export async function listViewerGroups(env, viewerId) {
  const db = env.FORUM_DB;
  const lastVisible = (column) =>
    "(SELECT m." + column + " FROM dm_group_messages m WHERE m.group_id = g.id AND " +
    VISIBLE_GROUP_MESSAGE_SQL + " ORDER BY m.id DESC LIMIT 1)";
  const rows = (await db.prepare(
    "SELECT g.id, g.name, g.created_at, gm.unread, " +
    lastVisible("body") + " AS last_body, " + lastVisible("created_at") + " AS last_at " +
    "FROM dm_group_members gm JOIN dm_groups g ON g.id = gm.group_id WHERE gm.user_id = ? " +
    "ORDER BY COALESCE(last_at, g.created_at) DESC, g.id DESC",
  ).bind(viewerId, viewerId, viewerId, viewerId, viewerId).all()).results || [];
  if (rows.length === 0) return [];
  const memberRows = (await db.prepare(
    MEMBER_ROWS_SQL + " AND gm.group_id IN (SELECT group_id FROM dm_group_members WHERE user_id = ?) " +
    "ORDER BY u.username_key",
  ).bind(viewerId).all()).results || [];
  return rows.map((row) => {
    const preview = String(row.last_body ?? "").trim();
    return {
      id: Number(row.id),
      name: row.name,
      members: memberRows.filter((member) => Number(member.group_id) === Number(row.id)).map(shapeMember),
      unread: Number(row.unread),
      lastMessageAt: row.last_at ? isoTime(row.last_at) : null,
      lastMessagePreview: preview.slice(0, GROUP_PREVIEW_MAX_CHARS),
    };
  });
}

export async function viewerGroupUnread(db, viewerId) {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(unread), 0) AS unread FROM dm_group_members WHERE user_id = ?",
  ).bind(viewerId).first();
  return Number(row?.unread || 0);
}

// Resolves one invitee by username key: must exist, must not be the actor,
// must not be actively banned.
async function resolveInvitee(db, rawUsername, actorId) {
  const key = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
  if (!key) throw new HttpError(400, "That member does not exist.");
  const row = await db.prepare(
    "SELECT u.id, u.username, u.role, " + activeBanSql("u.id") + " AS banned FROM users u WHERE u.username_key = ? LIMIT 1",
  ).bind(key).first();
  if (!row) throw new HttpError(400, "That member does not exist.");
  if (Number(row.id) === Number(actorId)) throw new HttpError(400, "You are already in this group.");
  if (Number(row.banned)) throw new HttpError(400, "That member cannot join a group right now.");
  return row;
}

// True when any id in `ids` and any id in `againstIds` form a block pair
// (either direction). With one list, that is any pair inside the set.
async function anyBlockPair(db, ids, againstIds = ids) {
  const left = ids.map(() => "?").join(", ");
  const right = againstIds.map(() => "?").join(", ");
  const row = await db.prepare(
    "SELECT 1 FROM blocks WHERE (blocker_id IN (" + left + ") AND blocked_id IN (" + right + ")) " +
    "OR (blocked_id IN (" + left + ") AND blocker_id IN (" + right + ")) LIMIT 1",
  ).bind(...ids, ...againstIds, ...ids, ...againstIds).first();
  return Boolean(row);
}

function readGroupName(env, raw) {
  const name = applyWordFilter(String(raw ?? "").trim(), filterWords(env));
  if (name.length > DM_GROUP_NAME_MAX_CHARS) {
    throw new HttpError(400, "Group names can be up to " + DM_GROUP_NAME_MAX_CHARS + " characters.");
  }
  return name;
}

// The shared text-body intake for DM sends: 1000-char cap, word filter, and
// the image-token refusal (only the upload routes may write that shape).
export function readDmMessageBody(env, raw) {
  const message = applyWordFilter(String(raw ?? "").trim().slice(0, DM_MAX_BODY_CHARS), filterWords(env));
  if (!message) throw new HttpError(400, "Write something first.");
  if (DM_IMAGE_TOKEN_PATTERN.test(message)) throw new HttpError(400, "That message is not valid.");
  return message;
}

const inviteRangeError = () =>
  new HttpError(400, "Add between 1 and " + (DM_GROUP_MAX_MEMBERS - 1) + " members.");

// POST /api/dm/groups — create with 1..(cap - 1) invitees.
async function handleGroupCreateRoute(request, env, url, path, method) {
  if (path !== "/api/dm/groups" || method !== "POST") return null;
  const session = await requireUser(request, env);
  const viewerId = session.user.id;
  await assertNotBanned(env, viewerId);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  const name = readGroupName(env, body.name);
  const usernames = Array.isArray(body.usernames) ? body.usernames : [];
  if (usernames.length === 0 || usernames.length > DM_GROUP_MAX_MEMBERS * 2) throw inviteRangeError();
  const invitees = new Map();
  for (const username of usernames) {
    const row = await resolveInvitee(env.FORUM_DB, username, viewerId);
    invitees.set(Number(row.id), row);
  }
  if (invitees.size > DM_GROUP_MAX_MEMBERS - 1) throw inviteRangeError();
  const memberIds = [viewerId, ...invitees.keys()];
  if (await anyBlockPair(env.FORUM_DB, memberIds)) {
    throw new HttpError(403, "Those members cannot all be in one group.");
  }
  const now = nowSeconds();
  const created = await env.FORUM_DB.prepare(
    "INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, ?, ?)",
  ).bind(viewerId, name, now).run();
  const groupId = Number(created.meta?.last_row_id);
  try {
    await env.FORUM_DB.batch(memberIds.map((id) => env.FORUM_DB.prepare(
      "INSERT INTO dm_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)",
    ).bind(groupId, id, now)));
  } catch (error) {
    // No half-made group: drop the shell row, then surface the failure.
    await env.FORUM_DB.prepare("DELETE FROM dm_groups WHERE id = ?").bind(groupId).run();
    throw error;
  }
  return json({
    id: groupId,
    name,
    members: [shapeMember(session.user), ...[...invitees.values()].map(shapeMember)],
  }, 201);
}

// GET /api/dm/groups/:id — members, the newest 50 visible messages (newest
// first), ?after=<id> for older pages.
async function handleGroupReadRoute(request, env, url, path, method) {
  const match = path.match(GROUP_ROUTE);
  if (!match || method !== "GET") return null;
  const session = await requireSignedInRead(request, env);
  const viewerId = session.user.id;
  const group = await loadGroupForMember(env, Number(match[1]), viewerId);
  const after = Number(url.searchParams.get("after") || 0);
  const older = Number.isInteger(after) && after > 0;
  const statement =
    "SELECT m.id, m.body, m.user_id, m.created_at, u.username AS author_username " +
    "FROM dm_group_messages m JOIN users u ON u.id = m.user_id " +
    "WHERE m.group_id = ? AND " + VISIBLE_GROUP_MESSAGE_SQL + (older ? " AND m.id < ?" : "") +
    " ORDER BY m.id DESC LIMIT " + GROUP_MESSAGE_PAGE_LIMIT;
  const binds = [Number(group.id), viewerId, viewerId, ...(older ? [after] : [])];
  const rows = (await env.FORUM_DB.prepare(statement).bind(...binds).all()).results || [];
  const members = (await env.FORUM_DB.prepare(MEMBER_ROWS_SQL + " AND gm.group_id = ? ORDER BY u.username_key")
    .bind(Number(group.id)).all()).results || [];
  return json({
    id: Number(group.id),
    name: group.name,
    creatorId: group.creator_id === null ? null : Number(group.creator_id),
    canManage: Number(group.creator_id) === Number(viewerId),
    members: members.map(shapeMember),
    unread: Number(group.unread),
    messages: rows.map((row) => dmMessageShape(row, viewerId)),
  });
}

// POST /api/dm/groups/:id — the send: membership, ban, rate, body, then the
// insert and the other members' unread bump in one batch.
async function handleGroupSendRoute(request, env, url, path, method) {
  const match = path.match(GROUP_ROUTE);
  if (!match || method !== "POST") return null;
  const session = await requireUser(request, env);
  const viewerId = session.user.id;
  const group = await loadGroupForMember(env, Number(match[1]), viewerId);
  await assertNotBanned(env, viewerId);
  await rateLimit(request, env, "write");
  const message = readDmMessageBody(env, (await readJson(request)).body);
  const now = nowSeconds();
  const [inserted] = await env.FORUM_DB.batch(
    groupMessageStatements(env.FORUM_DB, Number(group.id), viewerId, message, now),
  );
  return json({
    message: {
      id: Number(inserted.meta?.last_row_id),
      body: message,
      authorId: viewerId,
      authorUsername: session.user.username,
      mine: true,
      createdAt: isoTime(now),
    },
  }, 201);
}

// POST /api/dm/groups/:id/read — zero the viewer's own counter.
async function handleGroupReadMarkRoute(request, env, url, path, method) {
  const match = path.match(GROUP_READ_MARK_ROUTE);
  if (!match || method !== "POST") return null;
  const session = await requireUser(request, env);
  const group = await loadGroupForMember(env, Number(match[1]), session.user.id);
  await env.FORUM_DB.prepare("UPDATE dm_group_members SET unread = 0 WHERE group_id = ? AND user_id = ?")
    .bind(Number(group.id), session.user.id).run();
  return json({ ok: true });
}

// The creator gate for add/remove: a member who is not the creator gets 403.
async function loadManagedGroup(request, env, groupId) {
  const session = await requireUser(request, env);
  const group = await loadGroupForMember(env, groupId, session.user.id);
  if (Number(group.creator_id) !== Number(session.user.id)) {
    throw new HttpError(403, "Only the group's creator can change its members.");
  }
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  return { session, group };
}

// POST /api/dm/groups/:id/members {username} — the cap rides the INSERT's
// own WHERE, so two racing adds can never overfill the group.
async function handleGroupAddRoute(request, env, url, path, method) {
  const match = path.match(GROUP_MEMBERS_ROUTE);
  if (!match || method !== "POST") return null;
  const { session, group } = await loadManagedGroup(request, env, Number(match[1]));
  const groupId = Number(group.id);
  const invitee = await resolveInvitee(env.FORUM_DB, (await readJson(request)).username, session.user.id);
  const inviteeId = Number(invitee.id);
  const memberIds = ((await env.FORUM_DB.prepare("SELECT user_id FROM dm_group_members WHERE group_id = ?")
    .bind(groupId).all()).results || []).map((row) => Number(row.user_id));
  if (memberIds.includes(inviteeId)) throw new HttpError(400, "That member is already in this group.");
  if (await anyBlockPair(env.FORUM_DB, [inviteeId], memberIds)) {
    throw new HttpError(403, "That member cannot join this group.");
  }
  const added = await env.FORUM_DB.prepare(
    "INSERT INTO dm_group_members (group_id, user_id, joined_at) SELECT ?, ?, ? " +
    "WHERE (SELECT COUNT(*) FROM dm_group_members WHERE group_id = ?) < ?",
  ).bind(groupId, inviteeId, nowSeconds(), groupId, DM_GROUP_MAX_MEMBERS).run();
  if (Number(added.meta?.changes) !== 1) {
    throw new HttpError(400, "Groups can have up to " + DM_GROUP_MAX_MEMBERS + " members.");
  }
  return json({ ok: true, member: shapeMember(invitee) });
}

// DELETE /api/dm/groups/:id/members/:userId — the creator removes someone
// else (leaving is its own route).
async function handleGroupRemoveRoute(request, env, url, path, method) {
  const match = path.match(GROUP_MEMBER_ROUTE);
  if (!match || method !== "DELETE") return null;
  const { session, group } = await loadManagedGroup(request, env, Number(match[1]));
  const targetId = Number(match[2]);
  if (targetId === Number(session.user.id)) throw new HttpError(400, "Use Leave to leave the group.");
  const removed = await env.FORUM_DB.prepare("DELETE FROM dm_group_members WHERE group_id = ? AND user_id = ?")
    .bind(Number(group.id), targetId).run();
  if (Number(removed.meta?.changes) !== 1) throw new HttpError(404, "That member is not in this group.");
  return json({ ok: true });
}

// POST /api/dm/groups/:id/leave — any member (banned ones too); the last one
// out deletes the group (its messages and images cascade).
async function handleGroupLeaveRoute(request, env, url, path, method) {
  const match = path.match(GROUP_LEAVE_ROUTE);
  if (!match || method !== "POST") return null;
  const session = await requireUser(request, env);
  const group = await loadGroupForMember(env, Number(match[1]), session.user.id);
  const groupId = Number(group.id);
  await env.FORUM_DB.batch([
    env.FORUM_DB.prepare("DELETE FROM dm_group_members WHERE group_id = ? AND user_id = ?")
      .bind(groupId, session.user.id),
    env.FORUM_DB.prepare(
      "DELETE FROM dm_groups WHERE id = ? AND NOT EXISTS (SELECT 1 FROM dm_group_members WHERE group_id = ?)",
    ).bind(groupId, groupId),
  ]);
  return json({ ok: true });
}

export async function handleDmGroupRoutes(request, env, url, path, method, ctx) {
  if (!path.startsWith("/api/dm/groups")) return null;
  const handlers = [
    handleGroupCreateRoute,
    handleGroupReadRoute,
    handleGroupSendRoute,
    handleGroupReadMarkRoute,
    handleGroupAddRoute,
    handleGroupRemoveRoute,
    handleGroupLeaveRoute,
  ];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}
