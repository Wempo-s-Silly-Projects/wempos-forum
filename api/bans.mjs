
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

// v4.0 plan 3, Task 3: the "who bans" module — active ban list, ban
// create/revoke (timed-ban durations, opt-in IP bans), and the ban mutation
// route. Moved verbatim from api/moderation.mjs (see the plan-3 rulings: the
// moderation seam is "who bans vs who reviews vs who manages roles"). The
// composer re-exports createUserBan — worker.mjs imports it from moderation
// .mjs and that surface does not change.
import { UNBAN_ACTIVE_UPDATE_SQL } from "../constants.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, readJson, requiredText } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";

async function handleBanListRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/bans" && method === "GET") {
    await requireStaff(request, env, false);
    const result = await db.prepare(
      "SELECT b.id, b.user_id, b.reason, b.expires_at, u.username " +
        "FROM bans b JOIN users u ON u.id = b.user_id " +
        "WHERE b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?) " +
        "ORDER BY b.created_at DESC LIMIT 200",
    ).bind(nowSeconds()).all();

    return json({
      bans: (result.results || []).map((row) => ({
        id: Number(row.id),
        user: { id: Number(row.user_id), username: row.username },
        reason: row.reason,
        expiresAt: row.expires_at
          ? new Date(Number(row.expires_at) * 1000).toISOString()
          : null,
      })),
    });
  }
  return null;
}

// The ban core: expire stale timed bans, insert the new ban unless one is
// active (409), drop the member's sessions, and — opt-in — copy known network
// hashes to banned_ips. Shared by the mod ban route and AutoMod (modId null).
// Returns the new ban id.
export async function applyUserBan(db, {
  targetId,
  modId,
  reason,
  expiresAt,
  ipBan = false,
}) {
  const now = nowSeconds();

  // Expire stale bans and attempt the new insert together. Do not delete
  // sessions in this batch: a conditional INSERT that affects zero rows does
  // not abort a D1 batch, so a separate DELETE here could sign out a member
  // even though this request failed with 409.
  const results = await db.batch([
    db.prepare(
      "UPDATE bans SET revoked_at = ?, revoked_by = ?, revocation_reason = 'Expired automatically' " +
        "WHERE user_id = ? AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?",
    ).bind(now, modId, targetId, now),

    db.prepare(
      "INSERT INTO bans (user_id, reason, created_at, created_by, expires_at) " +
        "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(targetId, reason, now, modId, expiresAt, targetId, now),
  ]);

  const inserted = results[1];
  if (Number(inserted?.meta?.changes) !== 1) {
    throw new HttpError(409, "This member is already banned.");
  }

  const banId = Number(inserted.meta.last_row_id);
  if (!Number.isSafeInteger(banId) || banId < 1) {
    throw new HttpError(500, "The ban was created but its identifier could not be read.");
  }

  // Only invalidate sessions after the insert has succeeded. The ban itself
  // is already active, so normal authorization checks also reject the member
  // if session cleanup encounters a storage error.
  await db.prepare(
    "DELETE FROM sessions WHERE user_id = ?",
  ).bind(targetId).run();

  // IP bans are opt-in per ban. Copy only the member's known keyed hashes;
  // raw IP addresses are never stored. Rows are associated with this exact
  // ban so another ban for the same network remains independent.
  if (ipBan) {
    await db.prepare(
      "INSERT OR IGNORE INTO banned_ips (ip_hash, ban_id, created_at) " +
        "SELECT ip_hash, ?, ? FROM known_ips WHERE user_id = ?",
    ).bind(banId, now, targetId).run();
  }

  return banId;
}

export async function createUserBan(db, targetId, modId, request, env) {
  const body = await readJson(request);
  const reason = applyWordFilter(
    requiredText(body.reason, "ban reason", 500),
    filterWords(env),
  );

  const now = nowSeconds();

  // Timed bans: absent/null means permanent. Otherwise the expiry must be
  // more than a minute and no more than a year from now.
  let expiresAt = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    const candidate = Number(body.expiresAt);
    if (
      !Number.isSafeInteger(candidate) ||
      candidate <= now + 60 ||
      candidate > now + 366 * 86400
    ) {
      throw new HttpError(400, "The ban duration must be between a minute and a year from now.");
    }
    expiresAt = candidate;
  }

  await applyUserBan(db, {
    targetId,
    modId,
    reason,
    expiresAt,
    ipBan: body.ipBan === true || body.ipBan === "true",
  });

  return json({ ok: true, expiresAt }, 201);
}

async function revokeUserBan(db, targetId, modId, request, env) {
  const body = await readJson(request);
  const reason = applyWordFilter(
    requiredText(body.reason, "unban reason", 500),
    filterWords(env),
  );

  const now = nowSeconds();
  const active = await db.prepare(
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1",
  ).bind(targetId, now).first();

  if (!active) {
    throw new HttpError(404, "No active ban was found for this member.");
  }

  const banId = Number(active.id);

  // Revoke the selected ban and clean up only its own IP rows in the same
  // D1 batch. The cleanup predicate checks the resulting revocation fields,
  // so a concurrent revocation with different details cannot remove this
  // ban's network restrictions.
  const results = await db.batch([
    db.prepare(UNBAN_ACTIVE_UPDATE_SQL)
      .bind(now, modId, reason, banId, targetId, now),

    db.prepare(
      "DELETE FROM banned_ips WHERE ban_id = ? AND EXISTS (" +
        "SELECT 1 FROM bans WHERE id = ? AND user_id = ? " +
        "AND revoked_at = ? AND revoked_by IS ? AND revocation_reason = ?)",
    ).bind(banId, banId, targetId, now, modId, reason),
  ]);

  if (Number(results[0]?.meta?.changes) !== 1) {
    throw new HttpError(409, "This ban was already revoked by another mod.");
  }

  return json({ ok: true });
}

async function handleBanMutationRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/users\/([0-9]+)\/bans$/);
  if (!match || (method !== "POST" && method !== "DELETE")) return null;

  const session = await requireStaff(request, env);
  const targetId = Number(match[1]);

  if (!Number.isSafeInteger(targetId) || targetId < 1) {
    throw new HttpError(404, "Member not found.");
  }

  const db = env.FORUM_DB;
  const target = await db.prepare(
    "SELECT id, role FROM users WHERE id = ? LIMIT 1",
  ).bind(targetId).first();

  if (!target) throw new HttpError(404, "Member not found.");

  // Stored role vocabulary is translated to the public vocabulary here.
  // Owner accounts and the acting moderator's own account cannot be banned.
  if (
    publicRole(target.role) === "owner" ||
    targetId === Number(session.user.id)
  ) {
    throw new HttpError(403, "Owner accounts cannot be banned here.");
  }

  if (method === "POST") {
    return createUserBan(db, targetId, session.user.id, request, env);
  }

  return revokeUserBan(db, targetId, session.user.id, request, env);
}

export {
  handleBanListRoute,
  handleBanMutationRoute,
  revokeUserBan,
};
