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

// Wave 5.36 F2: search inside one conversation.
//   GET /api/dm/threads/:id/search?q=  — a 1:1 thread's participants only
//   GET /api/dm/groups/:id/search?q=   — the group's members only
// A non-participant gets the exact 404 a missing conversation gets, so the
// route never reveals that a conversation exists. q is 2–100 characters,
// matched with LIKE on a bound, wildcard-escaped pattern (ESCAPE '\'), the
// newest CONVERSATION_SEARCH_LIMIT hits first. Messages by an actively banned
// or block-paired author are excluded with the chat view's own predicates.
// Each hit carries only id, author, time and a spoiler-masked excerpt around
// the match. The query is read-only: it is never logged or kept.
import { requireSignedInRead } from "./core/auth.mjs";
import { HttpError, json } from "./core/http.mjs";
import { maskSpoilers, maskedExcerpt } from "./core/spoilers.mjs";
import { DM_VISIBLE_MESSAGE_SQL, isoTime } from "./chat.mjs";
import { VISIBLE_GROUP_MESSAGE_SQL, loadGroupForMember } from "./dm-groups.mjs";

export const CONVERSATION_SEARCH_LIMIT = 50;
const QUERY_MIN_CHARS = 2;
const QUERY_MAX_CHARS = 100;
const EXCERPT_MAX_CHARS = 120;
const EXCERPT_LEAD_CHARS = 40;
const ELLIPSIS = "…";
const NOT_AVAILABLE = "That conversation does not exist.";
const THREAD_SEARCH_ROUTE = /^\/api\/dm\/threads\/([0-9]{1,15})\/search$/;
const GROUP_SEARCH_ROUTE = /^\/api\/dm\/groups\/([0-9]{1,15})\/search$/;

const THREAD_SEARCH_SQL =
  "SELECT m.id, m.body, m.created_at, u.username AS author_username " +
  "FROM dm_messages m JOIN users u ON u.id = m.user_id " +
  "WHERE m.thread_id = ? AND " + DM_VISIBLE_MESSAGE_SQL + " AND m.body LIKE ? ESCAPE '\\' " +
  "ORDER BY m.id DESC LIMIT " + CONVERSATION_SEARCH_LIMIT;
const GROUP_SEARCH_SQL =
  "SELECT m.id, m.body, m.created_at, u.username AS author_username " +
  "FROM dm_group_messages m JOIN users u ON u.id = m.user_id " +
  "WHERE m.group_id = ? AND " + VISIBLE_GROUP_MESSAGE_SQL + " AND m.body LIKE ? ESCAPE '\\' " +
  "ORDER BY m.id DESC LIMIT " + CONVERSATION_SEARCH_LIMIT;

// "%<q>%" with the escape character, % and _ escaped so each matches itself.
export function conversationLikePattern(query) {
  return "%" + String(query).replace(/[\\%_]/g, (character) => "\\" + character) + "%";
}

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

// A window of the MASKED body around the first match (masking first, so a
// spoiler never leaks; a match hidden inside a spoiler falls back to the
// opening of the message). Never cuts an emoji's surrogate pair.
export function matchExcerpt(body, query, max = EXCERPT_MAX_CHARS) {
  const masked = maskSpoilers(String(body ?? ""));
  if (masked.length <= max) return masked;
  const lower = masked.toLowerCase();
  const at = lower.length === masked.length ? lower.indexOf(String(query).toLowerCase()) : -1;
  if (at < 0) return maskedExcerpt(masked, max);
  let end = Math.min(masked.length, Math.max(0, at - EXCERPT_LEAD_CHARS) + max);
  let start = Math.max(0, end - max);
  if (start > 0 && isLowSurrogate(masked.charCodeAt(start))) start += 1;
  if (end < masked.length && isHighSurrogate(masked.charCodeAt(end - 1))) end -= 1;
  return (start > 0 ? ELLIPSIS : "") + masked.slice(start, end) + (end < masked.length ? ELLIPSIS : "");
}

function readQuery(url) {
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < QUERY_MIN_CHARS || query.length > QUERY_MAX_CHARS) {
    throw new HttpError(400, "Search must be 2–100 characters long.");
  }
  return query;
}

const shapeHit = (query) => (row) => ({
  id: Number(row.id),
  authorUsername: row.author_username,
  createdAt: isoTime(row.created_at),
  maskedExcerpt: matchExcerpt(row.body, query),
});

async function threadSearch(request, env, url, threadId) {
  const session = await requireSignedInRead(request, env);
  const viewerId = session.user.id;
  const query = readQuery(url);
  const thread = await env.FORUM_DB.prepare(
    "SELECT id FROM dm_threads WHERE id = ? AND (user_a = ? OR user_b = ?) LIMIT 1",
  ).bind(threadId, viewerId, viewerId).first();
  if (!thread) throw new HttpError(404, NOT_AVAILABLE);
  const rows = (await env.FORUM_DB.prepare(THREAD_SEARCH_SQL)
    .bind(threadId, viewerId, viewerId, conversationLikePattern(query)).all()).results || [];
  return json({ results: rows.map(shapeHit(query)) });
}

async function groupSearch(request, env, url, groupId) {
  const session = await requireSignedInRead(request, env);
  const viewerId = session.user.id;
  const query = readQuery(url);
  const group = await loadGroupForMember(env, groupId, viewerId);
  const rows = (await env.FORUM_DB.prepare(GROUP_SEARCH_SQL)
    .bind(Number(group.id), viewerId, viewerId, conversationLikePattern(query)).all()).results || [];
  return json({ results: rows.map(shapeHit(query)) });
}

export async function handleConversationSearchRoutes(request, env, url, path, method) {
  if (method !== "GET") return null;
  const thread = path.match(THREAD_SEARCH_ROUTE);
  if (thread) return threadSearch(request, env, url, Number(thread[1]));
  const group = path.match(GROUP_SEARCH_ROUTE);
  if (group) return groupSearch(request, env, url, Number(group[1]));
  return null;
}
