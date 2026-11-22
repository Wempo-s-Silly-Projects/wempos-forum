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

// Reactions on 1:1 DM messages (v5.44.0, migration 0070):
//   PUT    /api/dm/messages/:id/reaction { value } — set or switch (one per member);
//   DELETE /api/dm/messages/:id/reaction            — remove (idempotent).
// value ∈ REACTION_VALUES, the post-reaction allowlist. Gates, in order:
// session + same-origin + X-CSRF-Token, not banned, the reaction limiter,
// then the message: it must exist, the caller must be one of its thread's
// two participants (anyone else — members and staff alike — gets 404, never
// 403, so the route is no existence oracle), and its author must have no
// active ban (a banned author's message is hidden at read time, so it is
// 404 here too). A block pair either way refuses with 403.
// Reads: dmReactionsForPage feeds the thread read (api/chat.mjs) with ONE
// grouped query per page; a reaction by an actively banned member, or by
// the other participant across a block pair, is left out (read time — an
// unban or unblock restores it with no write). Group DMs are out of scope.
import { REACTION_VALUES } from "../constants.mjs";
import { assertNotBanned, requireUser } from "./core/auth.mjs";
import { blockPairExists } from "./core/blocks.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";

const REACTION_ROUTE = /^\/api\/dm\/messages\/([0-9]{1,15})\/reaction$/;
const NOT_FOUND = "Message not found.";
const UNAVAILABLE = "That conversation is not available.";

// The message with its thread pair, only when its author has no active ban.
const MESSAGE_SQL =
  "SELECT m.id, t.user_a, t.user_b FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id " +
  "WHERE m.id = ? AND NOT " + ACTIVE_BAN_SQL("m.user_id") + " LIMIT 1";

const UPSERT_SQL =
  "INSERT INTO dm_message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?) " +
  "ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at";

async function participantMessage(env, messageId, viewerId) {
  const row = await env.FORUM_DB.prepare(MESSAGE_SQL).bind(messageId).first();
  const isParticipant = row && (Number(row.user_a) === viewerId || Number(row.user_b) === viewerId);
  if (!isParticipant) throw new HttpError(404, NOT_FOUND);
  const otherId = Number(row.user_a) === viewerId ? Number(row.user_b) : Number(row.user_a);
  if (await blockPairExists(env, viewerId, otherId)) throw new HttpError(403, UNAVAILABLE);
  return row;
}

export async function handleDmReactionRoutes(request, env, url, path, method) {
  const match = path.match(REACTION_ROUTE);
  if (!match) return null;
  if (method !== "PUT" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await requireUser(request, env);
  const viewerId = Number(session.user.id);
  await assertNotBanned(env, viewerId);
  await rateLimit(request, env, "reaction", String(viewerId));
  const messageId = Number(match[1]);
  await participantMessage(env, messageId, viewerId);
  if (method === "DELETE") {
    await env.FORUM_DB.prepare("DELETE FROM dm_message_reactions WHERE message_id = ? AND user_id = ?")
      .bind(messageId, viewerId).run();
    return json({ ok: true, mine: null });
  }
  const { value } = await readJson(request);
  if (!REACTION_VALUES.includes(value)) throw new HttpError(400, "Choose like or dislike.");
  await env.FORUM_DB.prepare(UPSERT_SQL).bind(messageId, viewerId, value, nowSeconds()).run();
  return json({ ok: true, mine: value });
}

// One grouped query for a thread page: messages in [lowId, highId] of this
// thread. Binds: viewer (mine), thread, low, high, then — only when the other
// participant is hidden from the viewer (banned or block-paired) — the viewer
// again, keeping just the viewer's own reactions. Returns id → shape.
export async function dmReactionsForPage(db, { threadId, viewerId, messageIds, otherHidden }) {
  const shapes = new Map(messageIds.map((id) => [Number(id), { like: 0, dislike: 0, mine: null }]));
  if (!messageIds.length) return shapes;
  const low = Math.min(...messageIds);
  const high = Math.max(...messageIds);
  const rows = (await db.prepare(
    "SELECT r.message_id, r.emoji, COUNT(*) AS n, MAX(r.user_id = ?) AS mine " +
    "FROM dm_message_reactions r JOIN dm_messages m ON m.id = r.message_id " +
    "WHERE m.thread_id = ? AND r.message_id BETWEEN ? AND ? AND NOT " + ACTIVE_BAN_SQL("r.user_id") +
    (otherHidden ? " AND r.user_id = ?" : "") +
    " GROUP BY r.message_id, r.emoji",
  ).bind(viewerId, threadId, low, high, ...(otherHidden ? [viewerId] : [])).all()).results || [];
  for (const row of rows) {
    const shape = shapes.get(Number(row.message_id));
    if (!shape || !REACTION_VALUES.includes(row.emoji)) continue;
    shapes.set(Number(row.message_id), {
      ...shape,
      [row.emoji]: Number(row.n),
      mine: Number(row.mine) ? row.emoji : shape.mine,
    });
  }
  return shapes;
}
