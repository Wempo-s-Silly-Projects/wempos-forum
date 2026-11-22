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

// Private invite links (v5.34.0). A member shares /join?ref=<username>; the
// visitor's browser keeps the ref for the tab and, once signed in, claims it
// here exactly once (POST /api/me/invite { ref }).
//
// A claim lands only when ALL hold — otherwise it is ignored (200, inviter
// null, no row, no notification; no oracle beyond what a profile shows):
//   - the claimant's account is new (inside INVITE_CLAIM_WINDOW) and has no
//     invites row yet (user_id is the PK; INSERT OR IGNORE + meta.changes);
//   - the ref names an existing member who is not the claimant, has no
//     ACTIVE ban, joined before the claimant, and is not block-paired with
//     them in either direction.
// Then one row (user_id, inviter_id, created_at) and one label-only bell row
// for the inviter. Nothing else is stored and nothing is public.
//
// Read side: GET /api/session's user.invitedBy (the welcome card line) names
// the inviter only while they are unbanned and not block-paired, read-time.
import { assertNotBanned, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { isValidUsername } from "./core/shapers.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";
import { inviteJoinLabel, notifyStatement } from "./notifications.mjs";

// The newcomer window (public/js/newcomer.js NEWCOMER_WINDOW_MS): an account
// older than the welcome card cannot pick up an inviter after the fact.
export const INVITE_CLAIM_WINDOW_SECONDS = 7 * 24 * 60 * 60;

const PAIR_SQL = (a, b) =>
  "EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = " + a + " AND bk.blocked_id = " + b + ") " +
  "OR (bk.blocker_id = " + b + " AND bk.blocked_id = " + a + "))";

// Binds: claimant id (x2: the join + created_at compare), the claimant's
// earliest allowed created_at, the ref's username_key.
const ELIGIBLE_INVITER_SQL =
  "SELECT i.id, i.username FROM users me JOIN users i ON i.username_key = ? " +
  "WHERE me.id = ? AND me.created_at >= ? AND i.id <> me.id AND i.created_at <= me.created_at " +
  "AND NOT " + ACTIVE_BAN_SQL("i.id") + " AND NOT " + PAIR_SQL("i.id", "me.id") +
  " AND NOT EXISTS (SELECT 1 FROM invites iv WHERE iv.user_id = me.id) LIMIT 1";

const INSERT_INVITE_SQL = "INSERT OR IGNORE INTO invites (user_id, inviter_id, created_at) VALUES (?, ?, ?)";

const INVITED_BY_SQL =
  "SELECT i.username FROM invites iv JOIN users i ON i.id = iv.inviter_id WHERE iv.user_id = ? " +
  "AND NOT " + ACTIVE_BAN_SQL("i.id") + " AND NOT " + PAIR_SQL("i.id", "iv.user_id") + " LIMIT 1";

// invitedBy(env, userId) -> the inviter's username, or null (none, banned,
// block-paired). Never throws: a failed read is just no welcome line.
export async function invitedBy(env, userId) {
  try {
    const row = await env.FORUM_DB.prepare(INVITED_BY_SQL).bind(userId).first();
    return row ? String(row.username) : null;
  } catch (error) {
    console.error("Invite lookup failed; no welcome line:", error);
    return null;
  }
}

async function claimInvite(request, env) {
  const session = await requireUser(request, env);
  const me = session.user;
  await assertNotBanned(env, me.id);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  if (!isValidUsername(body?.ref)) throw new HttpError(400, "That invite link is not valid.");
  const now = nowSeconds();
  const inviter = await env.FORUM_DB.prepare(ELIGIBLE_INVITER_SQL)
    .bind(body.ref.toLowerCase(), me.id, now - INVITE_CLAIM_WINDOW_SECONDS).first();
  if (!inviter) return json({ inviter: null });
  const inserted = await env.FORUM_DB.prepare(INSERT_INVITE_SQL).bind(me.id, Number(inviter.id), now).run();
  // Lost a race with a parallel claim: the other request owns the ping.
  if (Number(inserted.meta?.changes) !== 1) return json({ inviter: null });
  await notifyStatement(env.FORUM_DB, Number(inviter.id), inviteJoinLabel(me.username)).run();
  return json({ inviter: String(inviter.username) });
}

export async function handleInviteRoutes(request, env, url, path, method) {
  if (path === "/api/me/invite" && method === "POST") return claimInvite(request, env);
  return null;
}
