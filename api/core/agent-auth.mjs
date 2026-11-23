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

// Agent bearer auth (MCP write tools): a trusted bot account presents
// `Authorization: Bearer <token>`. Only SHA-256 hex digests of tokens live
// server-side, in the AGENT_TOKENS secret: a JSON object
// {"<sha256hex>": <user id>}. The value is preferably the numeric user id
// (a number or an all-digit string), resolved by id so the token can never
// follow a freed-and-re-registered username; a non-numeric string is the
// legacy username form, resolved by username_key. The digest is compared
// against EVERY key in constant time (no early exit), and the result is shaped exactly like session.user from
// readSession so downstream gates (canViewPost, role checks, fan-out) treat
// the agent as an ordinary signed-in member. Any doubt answers null: unset or
// malformed secret, unknown token, missing row, or an active ban
// (assertNotBanned semantics). The token itself is never logged or echoed.
import { assertNotBanned } from "./auth.mjs";
import { equalConstantTime, sha256Hex } from "./crypto.mjs";
import { publicRole } from "./roles.mjs";

const BEARER_PATTERN = /^Bearer[ ]+([A-Za-z0-9._~+/=-]{16,512})$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

const NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,15}$/;
const AGENT_USER_COLUMNS =
  "SELECT id, username, role, bio, avatar_status, avatar_mime, avatar_version, totp_enabled FROM users ";
const AGENT_USER_BY_ID_SQL = AGENT_USER_COLUMNS + "WHERE id = ? LIMIT 1";
const AGENT_USER_BY_NAME_SQL = AGENT_USER_COLUMNS + "WHERE username_key = ? LIMIT 1";

// A mapped value: a positive safe-integer id (number or digit string), or a
// non-empty legacy username string.
function isMappedValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return typeof value === "string" && value !== "";
}

// Returns a frozen [[digest, value], ...] list, or null when the secret is
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
  const valid = entries.every(([digest, value]) => DIGEST_PATTERN.test(digest) && isMappedValue(value));
  return valid && entries.length > 0 ? Object.freeze(entries) : null;
}

function bearerToken(request) {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = header.trim().match(BEARER_PATTERN);
  return match ? match[1] : null;
}

// Constant-time over the whole list: every key is compared, no early return.
function matchEntry(entries, digest) {
  let found = null;
  for (const [key, value] of entries) {
    if (equalConstantTime(digest, key) && found === null) found = value;
  }
  return found;
}

// Numeric → lookup by id (preferred); otherwise the legacy username form.
function loadMappedUser(env, value) {
  const asText = String(value);

  if (/^[0-9]+$/.test(asText)) {
    const id = Number(asText);
    if (!Number.isSafeInteger(id) || id <= 0) return null;

    return env.FORUM_DB.prepare(AGENT_USER_BY_ID_SQL)
      .bind(id)
      .first();
  }

  return env.FORUM_DB.prepare(AGENT_USER_BY_NAME_SQL)
    .bind(asText.toLowerCase())
    .first();
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
  const mapped = matchEntry(entries, await sha256Hex(token));
  if (mapped === null) return null;
  const row = await loadMappedUser(env, mapped);
  if (!row || row.username === null || row.username === undefined) return null;
  try {
    await assertNotBanned(env, Number(row.id));
  } catch {
    return null;
  }
  return shapeSessionUser(row);
}
