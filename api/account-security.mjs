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

// Wave 5.14: the member's own security read + "sign out my other devices".
// GET /api/me/security answers with COUNTS ONLY — whether two-factor is on,
// how many unused backup codes remain, and how many other unexpired sessions
// this account holds. It never carries a code, hash, secret or session token.
// POST /api/me/sessions/sign-out-others ends every OTHER forum session of the
// caller (the calling session survives); guest rows and other members'
// sessions are never touched. Forum sessions only: the Wempo Accounts relay,
// the SSO redeem and the session cookie contract are unchanged.
import { requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { json, rateLimit } from "./core/http.mjs";

const NO_STORE = { "Cache-Control": "no-store" };

async function readSecurityCounts(db, userId, tokenHash) {
  const row = await db.prepare(
    "SELECT u.totp_enabled AS totp_enabled, " +
      "(SELECT COUNT(*) FROM totp_backup_codes b WHERE b.user_id = u.id AND b.used_at IS NULL) AS codes, " +
      "(SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.token_hash != ? AND s.expires_at > ?) AS others " +
      "FROM users u WHERE u.id = ? LIMIT 1",
  ).bind(tokenHash, nowSeconds(), userId).first();
  const totpEnabled = Number(row?.totp_enabled) === 1;
  return {
    totpEnabled,
    backupCodesLeft: totpEnabled ? Number(row?.codes) || 0 : 0,
    otherSessions: Number(row?.others) || 0,
  };
}

export async function handleAccountSecurityRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;

  if (path === "/api/me/security" && method === "GET") {
    const session = await requireSignedInRead(request, env);
    await rateLimit(request, env, "read", String(session.user.id));
    const counts = await readSecurityCounts(db, session.user.id, session.tokenHash);
    return json(counts, 200, NO_STORE);
  }

  if (path === "/api/me/sessions/sign-out-others" && method === "POST") {
    const session = await requireUser(request, env);
    await rateLimit(request, env, "write", String(session.user.id));
    const result = await db.prepare(
      "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
    ).bind(session.user.id, session.tokenHash).run();
    return json({ signedOut: Number(result.meta?.changes) || 0 }, 200, NO_STORE);
  }

  return null;
}
