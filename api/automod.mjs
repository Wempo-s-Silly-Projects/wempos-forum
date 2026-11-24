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

// AutoMod (v5.18): the accountless server-to-server surface a local AutoMod
// runner polls. Off unless env.AUTOMOD_ENABLED is exactly "true" AND the
// AUTOMOD_KEY secret is set — otherwise every /api/automod/* path answers 404.
// Auth is ONLY `Authorization: Bearer <key>` (constant-time compare over
// SHA-256 digests); no cookies, sessions or CSRF ride this surface.
//   GET  /api/automod/queue?after=<cursor>&limit=<n> — new posts, replies,
//        lobby messages, wall posts, profile edits and REPORTED DM
//        conversations; staff-authored items never appear.
//   POST /api/automod/action {type, id, action, reason, ban_hours}
//        hide (posts/replies, the desk's hide core) | ban (the desk's ban
//        core, capped at AUTOMOD_MAX_BAN_HOURS, appealable) | report (an
//        AutoMod log flag). Staff targets are refused; repeats are no-ops.
// Every applied action writes automod_actions (actor 'AutoMod' + reason);
// staff read it at GET /api/admin/automod and reverse hides/bans with the
// normal Restore and Unban controls.
import { applyUserBan } from "./bans.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { hidePostsBatch } from "./mod-tools.mjs";
import { requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requiredText } from "./core/http.mjs";
import { ROLE_ADMIN_DB, ROLE_OWNER_DB, publicRole } from "./core/roles.mjs";

export const AUTOMOD_MAX_BAN_HOURS = 24;
export const AUTOMOD_QUEUE_MAX = 50;
export const AUTOMOD_DM_CONTEXT = 30;
export const AUTOMOD_REASON_MAX = 480;
export const AUTOMOD_BAN_PREFIX = "AutoMod: ";
const ADMIN_LOG_LIMIT = 100;
const SECONDS_PER_HOUR = 3600;
const BEARER = /^Bearer ([\x21-\x7e]{1,512})$/;
const CURSOR = /^p([0-9]{1,15})\.l([0-9]{1,15})\.w([0-9]{1,15})\.u([0-9]{1,15})\.d([0-9]{1,15})$/;
const LIMIT = /^[0-9]{1,4}$/;
const TARGET_TYPES = new Set(["post", "reply", "lobby", "wall", "profile", "dm"]);
const ACTIONS = new Set(["hide", "ban", "report"]);
// Stored role literals (api/core/roles.mjs): never interpolate user input.
const NOT_STAFF_SQL = `u.role NOT IN ('${ROLE_OWNER_DB}', '${ROLE_ADMIN_DB}')`;

export function automodEnabled(env) {
  return env.AUTOMOD_ENABLED === "true" &&
    typeof env.AUTOMOD_KEY === "string" && env.AUTOMOD_KEY.trim() !== "";
}

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Constant-time: both sides hash to 32 bytes, then a full XOR sweep.
async function keyMatches(presented, expected) {
  const [a, b] = await Promise.all([digest(presented), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireAutoModKey(request, env) {
  const match = (request.headers.get("Authorization") || "").match(BEARER);
  if (!match || !(await keyMatches(match[1], env.AUTOMOD_KEY.trim()))) {
    throw new HttpError(401, "AutoMod authorization failed.");
  }
}

const iso = (seconds) => new Date(Number(seconds) * 1000).toISOString();
const author = (row) => ({ id: Number(row.author_id), username: row.username, role: publicRole(row.role) });
const isStaffRole = (stored) => ["owner", "admin"].includes(publicRole(stored));

// One statement per source, each `id > ?` ascending with a bound LIMIT
// (2 binds each); the DM context read binds one id per reported thread.
const SOURCES = [
  {
    key: "p",
    sql: "SELECT p.id, p.parent_id, p.body, p.board, p.visibility, p.created_at, u.id AS author_id, u.username, u.role " +
      `FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id > ? AND ${NOT_STAFF_SQL} ORDER BY p.id LIMIT ?`,
    shape: (row) => ({
      type: row.parent_id === null || row.parent_id === undefined ? "post" : "reply",
      id: Number(row.id),
      parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
      board: row.board || "general",
      hidden: row.visibility !== "public",
      body: row.body,
    }),
  },
  {
    key: "l",
    sql: "SELECT c.id, c.body, c.created_at, u.id AS author_id, u.username, u.role " +
      `FROM chat_messages c JOIN users u ON u.id = c.user_id WHERE c.id > ? AND ${NOT_STAFF_SQL} ORDER BY c.id LIMIT ?`,
    shape: (row) => ({ type: "lobby", id: Number(row.id), body: row.body }),
  },
  {
    key: "w",
    sql: "SELECT w.id, w.owner_id, w.body, w.created_at, u.id AS author_id, u.username, u.role " +
      `FROM wall_posts w JOIN users u ON u.id = w.author_id WHERE w.id > ? AND ${NOT_STAFF_SQL} ORDER BY w.id LIMIT ?`,
    shape: (row) => ({ type: "wall", id: Number(row.id), wallOwnerId: Number(row.owner_id), body: row.body }),
  },
  {
    key: "u",
    sql: "SELECT e.id AS seq, e.created_at, u.id AS author_id, u.username, u.role, u.bio, u.flair, u.banner_text " +
      `FROM automod_profile_edits e JOIN users u ON u.id = e.user_id WHERE e.id > ? AND ${NOT_STAFF_SQL} ORDER BY e.id LIMIT ?`,
    seq: (row) => Number(row.seq),
    shape: (row) => ({
      type: "profile",
      id: Number(row.author_id),
      body: [row.bio, row.flair, row.banner_text].filter((part) => typeof part === "string" && part.trim()).join("\n"),
    }),
  },
  {
    key: "d",
    sql: "SELECT r.id, r.thread_id, r.reason, r.created_at, u.id AS author_id, u.username, u.role " +
      "FROM dm_reports r JOIN users u ON u.id = r.reporter_id WHERE r.id > ? ORDER BY r.id LIMIT ?",
    shape: (row) => ({ type: "dm", id: Number(row.id), threadId: Number(row.thread_id), reason: row.reason, messages: [] }),
  },
];

const TAIL_SQL = "SELECT (SELECT COALESCE(MAX(id), 0) FROM posts) AS p, " +
  "(SELECT COALESCE(MAX(id), 0) FROM chat_messages) AS l, (SELECT COALESCE(MAX(id), 0) FROM wall_posts) AS w, " +
  "(SELECT COALESCE(MAX(id), 0) FROM automod_profile_edits) AS u, (SELECT COALESCE(MAX(id), 0) FROM dm_reports) AS d";

const formatCursor = (cursor) => SOURCES.map(({ key }) => key + cursor[key]).join(".");

function parseQueueParams(url) {
  const rawLimit = url.searchParams.get("limit");
  let limit = AUTOMOD_QUEUE_MAX;
  if (rawLimit !== null) {
    if (!LIMIT.test(rawLimit) || Number(rawLimit) < 1) throw new HttpError(400, "That limit is invalid.");
    limit = Math.min(Number(rawLimit), AUTOMOD_QUEUE_MAX);
  }
  const rawAfter = url.searchParams.get("after");
  if (rawAfter === null || rawAfter === "") return { limit, cursor: null };
  const match = rawAfter.match(CURSOR);
  if (!match) throw new HttpError(400, "That queue cursor is invalid.");
  const cursor = Object.fromEntries(SOURCES.map(({ key }, index) => [key, Number(match[index + 1])]));
  return { limit, cursor };
}

// k-way merge by created_at: each source's included items stay a prefix of
// its id-ascending rows, so per-source cursors never skip an item.
function mergeSources(lists, limit, cursor) {
  const heads = lists.map(() => 0);
  const next = { ...cursor };
  const picked = [];
  while (picked.length < limit) {
    let best = -1;
    lists.forEach((rows, index) => {
      if (heads[index] >= rows.length) return;
      if (best === -1 || Number(rows[heads[index]].created_at) < Number(lists[best][heads[best]].created_at)) best = index;
    });
    if (best === -1) break;
    const source = SOURCES[best];
    const row = lists[best][heads[best]];
    heads[best] += 1;
    next[source.key] = source.seq ? source.seq(row) : Number(row.id);
    picked.push({ ...source.shape(row), author: author(row), createdAt: iso(row.created_at) });
  }
  return { picked, next };
}

async function attachDmContext(db, items) {
  const dmItems = items.filter((item) => item.type === "dm");
  const threadIds = [...new Set(dmItems.map((item) => item.threadId))];
  if (!threadIds.length) return items;
  const rows = (await db.prepare(
    "SELECT * FROM (SELECT m.id, m.thread_id, m.body, m.created_at, u.id AS author_id, u.username, u.role, " +
      "ROW_NUMBER() OVER (PARTITION BY m.thread_id ORDER BY m.id DESC) AS rn " +
      "FROM dm_messages m JOIN users u ON u.id = m.user_id " +
      `WHERE m.thread_id IN (${threadIds.map(() => "?").join(", ")})) ` +
      `WHERE rn <= ${AUTOMOD_DM_CONTEXT} ORDER BY thread_id, id`,
  ).bind(...threadIds).all()).results || [];
  return items.map((item) => (item.type !== "dm" ? item : {
    ...item,
    messages: rows.filter((row) => Number(row.thread_id) === item.threadId).map((row) => ({
      id: Number(row.id), body: row.body, author: author(row), createdAt: iso(row.created_at),
    })),
  }));
}

async function handleQueue(request, env, url) {
  await rateLimit(request, env, "read", "automod");
  const db = env.FORUM_DB;
  const { limit, cursor } = parseQueueParams(url);
  if (!cursor) {
    const tail = await db.prepare(TAIL_SQL).first();
    const start = Object.fromEntries(SOURCES.map(({ key }) => [key, Number(tail?.[key]) || 0]));
    return json({ items: [], cursor: formatCursor(start) });
  }
  const results = await db.batch(SOURCES.map(({ key, sql }) => db.prepare(sql).bind(cursor[key], limit)));
  const { picked, next } = mergeSources(results.map((result) => result.results || []), limit, cursor);
  return json({ items: await attachDmContext(db, picked), cursor: formatCursor(next) });
}

const TARGET_SQL = {
  post: "SELECT p.id, p.author_id AS user_id, u.role FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ? LIMIT 1",
  lobby: "SELECT c.id, c.user_id, u.role FROM chat_messages c JOIN users u ON u.id = c.user_id WHERE c.id = ? LIMIT 1",
  wall: "SELECT w.id, w.author_id AS user_id, u.role FROM wall_posts w JOIN users u ON u.id = w.author_id WHERE w.id = ? LIMIT 1",
  profile: "SELECT u.id, u.id AS user_id, u.role FROM users u WHERE u.id = ? LIMIT 1",
  // A DM message is reachable ONLY when a participant reported its thread.
  dm: "SELECT m.id, m.user_id, u.role FROM dm_messages m JOIN users u ON u.id = m.user_id " +
    "WHERE m.id = ? AND EXISTS (SELECT 1 FROM dm_reports r WHERE r.thread_id = m.thread_id) LIMIT 1",
};

function readAction(body) {
  const rawType = typeof body?.type === "string" ? body.type : "";
  if (!TARGET_TYPES.has(rawType)) throw new HttpError(400, "Choose a valid target type.");
  if (!ACTIONS.has(body.action)) throw new HttpError(400, "Choose hide, ban or report.");
  const id = body.id;
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "That target id is invalid.");
  const reason = requiredText(body.reason, "reason", AUTOMOD_REASON_MAX);
  return { type: rawType === "reply" ? "post" : rawType, id, action: body.action, reason };
}

function readBanHours(raw) {
  const hours = typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(hours) || hours < 1) throw new HttpError(400, "Ban hours must be a positive number.");
  // Clamp, never refuse: an over-long request still gets the capped ban.
  return Math.min(Math.floor(hours), AUTOMOD_MAX_BAN_HOURS);
}

function logStatement(db, entry) {
  return db.prepare(
    "INSERT INTO automod_actions (actor, action, target_type, target_id, target_user_id, reason, ban_id, ban_hours, created_at) " +
      "VALUES ('AutoMod', ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(entry.action, entry.type, entry.id, entry.userId, entry.reason, entry.banId ?? null, entry.banHours ?? null, nowSeconds());
}

async function runHide(db, target, request) {
  if (request.type !== "post") throw new HttpError(400, "Only posts and replies can be hidden.");
  const hidden = await hidePostsBatch(db, [request.id], Number(target.user_id), null);
  if (!hidden) return { already: true };
  await logStatement(db, { ...request, userId: Number(target.user_id) }).run();
  return {};
}

async function runBan(db, env, target, request, rawHours) {
  const banHours = readBanHours(rawHours);
  const userId = Number(target.user_id);
  const reason = applyWordFilter(AUTOMOD_BAN_PREFIX + request.reason, filterWords(env));
  let banId;
  try {
    banId = await applyUserBan(db, {
      targetId: userId, modId: null, reason, expiresAt: nowSeconds() + banHours * SECONDS_PER_HOUR,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) return { already: true, banHours };
    throw error;
  }
  await logStatement(db, { ...request, userId, banId, banHours }).run();
  return { banHours };
}

async function runReport(db, target, request) {
  const result = await db.prepare(
    "INSERT INTO automod_actions (actor, action, target_type, target_id, target_user_id, reason, created_at) " +
      "SELECT 'AutoMod', 'report', ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
      "SELECT 1 FROM automod_actions WHERE action = 'report' AND target_type = ? AND target_id = ?)",
  ).bind(request.type, request.id, Number(target.user_id), request.reason, nowSeconds(), request.type, request.id).run();
  return Number(result.meta?.changes) === 1 ? {} : { already: true };
}

async function handleAction(request, env) {
  await rateLimit(request, env, "write", "automod");
  const body = await readJson(request);
  const parsed = readAction(body);
  const db = env.FORUM_DB;
  const target = await db.prepare(TARGET_SQL[parsed.type]).bind(parsed.id).first();
  if (!target) throw new HttpError(404, "Target not found.");
  if (isStaffRole(target.role)) throw new HttpError(403, "AutoMod never acts on staff.");
  let outcome;
  if (parsed.action === "hide") outcome = await runHide(db, target, parsed);
  else if (parsed.action === "ban") outcome = await runBan(db, env, target, parsed, body.ban_hours);
  else outcome = await runReport(db, target, parsed);
  return json({ ok: true, action: parsed.action, type: parsed.type, id: parsed.id, ...outcome });
}

// The desk's AutoMod log (staff): newest first, with whether each hide is
// still in force and whether the target still has an active ban.
async function handleAdminLog(request, env) {
  await requireStaff(request, env, false);
  const rows = (await env.FORUM_DB.prepare(
    "SELECT a.id, a.actor, a.action, a.target_type, a.target_id, a.target_user_id, a.reason, a.ban_hours, a.created_at, " +
      "u.username, " +
      "(a.target_type = 'post' AND EXISTS (SELECT 1 FROM posts p WHERE p.id = a.target_id AND p.visibility = 'hidden')) AS still_hidden, " +
      "EXISTS (SELECT 1 FROM bans b WHERE b.id = a.ban_id AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) AS ban_active " +
      "FROM automod_actions a LEFT JOIN users u ON u.id = a.target_user_id " +
      `ORDER BY a.id DESC LIMIT ${ADMIN_LOG_LIMIT}`,
  ).all()).results || [];
  return json({
    actions: rows.map((row) => ({
      id: Number(row.id),
      actor: row.actor,
      action: row.action,
      type: row.target_type,
      targetId: Number(row.target_id),
      target: row.target_user_id === null ? null : { id: Number(row.target_user_id), username: row.username },
      reason: row.reason,
      banHours: row.ban_hours === null ? null : Number(row.ban_hours),
      stillHidden: Number(row.still_hidden) === 1,
      banActive: Number(row.ban_active) === 1,
      createdAt: iso(row.created_at),
    })),
  });
}

// Profile edits feed the queue's profile source — recorded only while
// AutoMod is switched on (no collection while it is off).
export async function recordProfileEdit(env, userId) {
  if (!automodEnabled(env)) return;
  await env.FORUM_DB.prepare("INSERT INTO automod_profile_edits (user_id, created_at) VALUES (?, ?)")
    .bind(userId, nowSeconds()).run();
}

export async function handleAutoModRoutes(request, env, url, path, method) {
  if (path === "/api/admin/automod" && method === "GET") return handleAdminLog(request, env);
  if (path !== "/api/automod" && !path.startsWith("/api/automod/")) return null;
  if (!automodEnabled(env)) throw new HttpError(404, "Not found.");
  await requireAutoModKey(request, env);
  if (path === "/api/automod/queue" && method === "GET") return handleQueue(request, env, url);
  if (path === "/api/automod/action" && method === "POST") return handleAction(request, env);
  throw new HttpError(404, "Not found.");
}
