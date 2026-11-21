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

// Agent bearer auth (MCP write tools): a trusted bot account presents
// `Authorization: Bearer <token>`. Only SHA-256 hex digests of tokens live
// server-side, in the AGENT_TOKENS secret: a JSON object
// {"<sha256hex>": "<username>"}. The digest is compared against EVERY key in
// constant time (no early exit), the mapped user row is loaded by
// username_key, and the result is shaped exactly like session.user from
// readSession so downstream gates (canViewPost, role checks, fan-out) treat
// the agent as an ordinary signed-in member. Any doubt answers null: unset or
// malformed secret, unknown token, missing row, or an active ban
// (assertNotBanned semantics). The token itself is never logged or echoed.
import { assertNotBanned } from "./auth.mjs";
import { equalConstantTime, sha256Hex } from "./crypto.mjs";
import { publicRole } from "./roles.mjs";

const BEARER_PATTERN = /^Bearer[ ]+([A-Za-z0-9._~+/=-]{16,512})$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

const AGENT_USER_SQL =
  "SELECT id, username, role, bio, avatar_status, avatar_mime, avatar_version, totp_enabled " +
  "FROM users WHERE username_key = ? LIMIT 1";

// Returns a frozen [[digest, username], ...] list, or null when the secret is
// unset or not the expected shape.
function parseAgentTokens(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  const valid = entries.every(([digest, username]) =>
    DIGEST_PATTERN.test(digest) && typeof username === "string" && username !== "");
  return valid && entries.length > 0 ? Object.freeze(entries) : null;
}

function bearerToken(request) {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = header.trim().match(BEARER_PATTERN);
  return match ? match[1] : null;
}

// Constant-time over the whole list: every key is compared, no early return.
function matchUsername(entries, digest) {
  let found = null;
  for (const [key, username] of entries) {
    if (equalConstantTime(digest, key) && found === null) found = username;
  }
  return found;
}

function shapeSessionUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    role: publicRole(row.role),
    bio: row.bio || "",
    avatarStatus: row.avatar_status || null,
    avatarUrl: row.avatar_mime ? "/api/avatars/" + row.id + "?v=" + row.avatar_version : null,
    totpEnabled: Number(row.totp_enabled) === 1,
  };
}

export async function agentFromRequest(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const entries = parseAgentTokens(env && env.AGENT_TOKENS);
  if (!entries) return null;
  const username = matchUsername(entries, await sha256Hex(token));
  if (!username) return null;
  const row = await env.FORUM_DB.prepare(AGENT_USER_SQL).bind(username.toLowerCase()).first();
  if (!row || row.username === null || row.username === undefined) return null;
  try {
    await assertNotBanned(env, Number(row.id));
  } catch {
    return null;
  }
  return shapeSessionUser(row);
}
