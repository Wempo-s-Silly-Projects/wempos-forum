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

// Saved searches (v5.48.0, migration 0073): GET/POST /api/me/saved-searches
// and DELETE /api/me/saved-searches/:id. A saved search is a name plus the
// search's q / by / in params, validated with api/search.mjs's own constants
// (imported, never copied). This module runs no search: the client turns a
// saved search into a link to the existing search page.
//
// Every statement is keyed on the SESSION's own id, so a saved search is
// visible only to its owner — never to other members, staff (no bypass) or
// guests. DELETE of an id that is not the caller's answers the same 404 as
// an id that does not exist (no existence oracle). A banned owner may list
// and delete but not save. At most SAVED_SEARCHES_MAX per member, checked
// inside the INSERT itself.
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { isValidUsername } from "./core/shapers.mjs";
import { SEARCH_IN_SCOPES, SEARCH_QUERY_MAX_CHARS } from "./search.mjs";
import { isRefusedChar } from "./thread-summaries.mjs";
import { SAVED_SEARCH_NAME_MAX_CHARS, SAVED_SEARCHES_MAX } from "../constants.mjs";

const LIST_PATH = "/api/me/saved-searches";
const ITEM_PATH = /^\/api\/me\/saved-searches\/([^/]{1,40})$/;
const ID_PATTERN = /^[1-9][0-9]{0,14}$/;

const LIST_SQL =
  "SELECT id, name, q, by_username, in_scope, created_at FROM saved_searches WHERE owner_id = ? " +
  "ORDER BY created_at DESC, id DESC LIMIT " + SAVED_SEARCHES_MAX;
const ONE_SQL =
  "SELECT id, name, q, by_username, in_scope, created_at FROM saved_searches WHERE id = ? AND owner_id = ? LIMIT 1";
const NAME_TAKEN_SQL = "SELECT 1 AS taken FROM saved_searches WHERE owner_id = ? AND name = ? LIMIT 1";
// Binds (7): owner, name, q, by, in, now, owner (the cap). A duplicate name
// does nothing (ON CONFLICT); a new row lands only while the owner is under
// SAVED_SEARCHES_MAX, checked inside the same statement.
const INSERT_SQL =
  "INSERT INTO saved_searches (owner_id, name, q, by_username, in_scope, created_at) SELECT ?, ?, ?, ?, ?, ? " +
  "WHERE (SELECT COUNT(*) FROM saved_searches WHERE owner_id = ?) < " + SAVED_SEARCHES_MAX + " " +
  "ON CONFLICT (owner_id, name) DO NOTHING";
const DELETE_SQL = "DELETE FROM saved_searches WHERE id = ? AND owner_id = ?";

const notFound = () => new HttpError(404, "Saved search not found.");
const isoOf = (seconds) => new Date(Number(seconds) * 1000).toISOString();
const shape = (row) => ({
  id: Number(row.id),
  name: row.name,
  q: row.q,
  by: row.by_username ?? null,
  in: row.in_scope ?? null,
  createdAt: isoOf(row.created_at),
});

// v5.54 (L1): a NUL trips the table CHECKs (SQLite's length() stops at it);
// names and queries are one line, so every control character is a 400.
const hasRefusedChar = (text) => [...text].some((ch) => isRefusedChar(ch.codePointAt(0)));

function savedName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || hasRefusedChar(name)) throw new HttpError(400, "Give the saved search a name.");
  if (name.length > SAVED_SEARCH_NAME_MAX_CHARS) {
    throw new HttpError(400, "Names can be up to " + SAVED_SEARCH_NAME_MAX_CHARS + " characters.");
  }
  return name;
}

// The same q rule as GET /api/search: 1..SEARCH_QUERY_MAX_CHARS after trim,
// measured on the lowercased text the search route compares. The trimmed
// text is stored as typed.
function savedQuery(value) {
  const q = typeof value === "string" ? value.trim() : "";
  if (!q || q.toLowerCase().length > SEARCH_QUERY_MAX_CHARS || hasRefusedChar(q)) {
    throw new HttpError(400, "Search must be 1–" + SEARCH_QUERY_MAX_CHARS + " characters long.");
  }
  return q;
}

// `in`: absent/empty = none; otherwise one of the search route's scopes.
function savedScope(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "The in param must be one of: " + SEARCH_IN_SCOPES.join(", ") + ".");
  const scope = value.trim().toLowerCase();
  if (!scope) return null;
  if (!SEARCH_IN_SCOPES.includes(scope)) {
    throw new HttpError(400, "The in param must be one of: " + SEARCH_IN_SCOPES.join(", ") + ".");
  }
  return scope;
}

// `by`: absent/empty = none; otherwise a well-formed username, stored as the
// lowercased key the search route looks up (an unknown member still just
// searches to no matches, exactly like the live route).
function savedAuthor(value) {
  if (value === undefined || value === null) return null;
  const by = typeof value === "string" ? value.trim() : null;
  if (by === "") return null;
  if (!isValidUsername(by)) throw new HttpError(400, "The by param must be a username.");
  return by.toLowerCase();
}

async function listSaved(env, ownerId) {
  const rows = await env.FORUM_DB.prepare(LIST_SQL).bind(ownerId).all();
  return json({ savedSearches: (rows.results || []).map(shape) });
}

async function createSaved(request, env, ownerId) {
  const input = await readJson(request);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Send a JSON object.");
  const name = savedName(input.name);
  const q = savedQuery(input.q);
  const by = savedAuthor(input.by);
  const scope = savedScope(input.in);
  const db = env.FORUM_DB;
  const result = await db.prepare(INSERT_SQL).bind(ownerId, name, q, by, scope, nowSeconds(), ownerId).run();
  if (Number(result.meta?.changes) !== 1) {
    const taken = await db.prepare(NAME_TAKEN_SQL).bind(ownerId, name).first();
    if (taken) throw new HttpError(409, "You already have a saved search with that name.");
    throw new HttpError(400, "You can keep up to " + SAVED_SEARCHES_MAX + " saved searches.");
  }
  const row = await db.prepare(ONE_SQL).bind(Number(result.meta.last_row_id), ownerId).first();
  if (!row) throw new HttpError(500, "The saved search could not be read back.");
  return json({ savedSearch: shape(row) }, 201);
}

async function deleteSaved(env, ownerId, rawId) {
  if (!ID_PATTERN.test(rawId)) throw notFound();
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) throw notFound();
  const result = await env.FORUM_DB.prepare(DELETE_SQL).bind(id, ownerId).run();
  if (Number(result.meta?.changes) !== 1) throw notFound();
  return json({ ok: true });
}

export async function handleSavedSearchRoutes(request, env, url, path, method) {
  const item = path.match(ITEM_PATH);
  if (path !== LIST_PATH && !item) return null;
  if (path === LIST_PATH && method === "GET") {
    const ownerId = Number((await requireSignedInRead(request, env)).user.id);
    return listSaved(env, ownerId);
  }
  const allowed = item ? method === "DELETE" : method === "POST";
  if (!allowed) throw new HttpError(405, "That method is not supported.");
  const session = await requireUser(request, env);
  const ownerId = Number(session.user.id);
  if (!item) await assertNotBanned(env, ownerId);
  await rateLimit(request, env, "write", String(ownerId));
  return item ? deleteSaved(env, ownerId, item[1]) : createSaved(request, env, ownerId);
}
