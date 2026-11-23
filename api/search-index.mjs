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

// The search module's index writer (docs/modules.md). The index lives in its
// own database (binding SEARCH_DB, migrations-search/), never in FORUM_DB.
//
// syncSearchPosts(env, request, ids) is called by the post write paths AFTER
// their write succeeded (create, edit, delete, hide, unhide, publish). It is
// best-effort and never blocks or fails the write: the work runs detached
// (handed to ctx.waitUntil when the worker registered one for this request),
// and every error is logged and swallowed. For each id it reconciles: the
// row is removed from the index, then re-added with its spoiler-masked body
// only if the post is publicly visible now (public, unbanned author, public
// unbanned ancestors). Bans, unbans and cascades are not mirrored: the read
// path re-checks the visibility law in FORUM_DB for every candidate, and the
// owner's rebuild prunes ids that no longer exist.
import { SEARCH_FTS_INSERT_CHUNK, SEARCH_SYNC_MAX_IDS } from "../constants.mjs";
import { isModuleOn } from "./core/modules.mjs";
import { maskSpoilers } from "./core/spoilers.mjs";
import { publicChainSql } from "./core/visibility.mjs";

const executionContexts = new WeakMap();

// worker.mjs registers each request's ExecutionContext so detached index
// work can be handed to waitUntil without threading ctx through handlers.
export function rememberExecutionContext(request, ctx) {
  if (request && typeof request === "object" && ctx) executionContexts.set(request, ctx);
}

// The publicly visible posts among a JSON list of ids (1 bind).
export const INDEXABLE_BY_IDS_SQL =
  "SELECT p.id, p.body FROM json_each(?) j JOIN posts p ON p.id = j.value WHERE " + publicChainSql("p");
export const INDEX_DELETE_SQL = "DELETE FROM post_search WHERE rowid = ?";
// Many rows per statement: a JSON array of [id, maskedBody] pairs (1 bind).
export const INDEX_INSERT_JSON_SQL =
  "INSERT INTO post_search (rowid, body) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') " +
  "FROM json_each(?)";

// Insert statements for [{ id, body }] rows, spoilers masked, chunked.
export function indexInsertStatements(searchDb, rows) {
  const statements = [];
  for (let at = 0; at < rows.length; at += SEARCH_FTS_INSERT_CHUNK) {
    const pairs = rows.slice(at, at + SEARCH_FTS_INSERT_CHUNK)
      .map((row) => [Number(row.id), maskSpoilers(String(row.body ?? ""))]);
    statements.push(searchDb.prepare(INDEX_INSERT_JSON_SQL).bind(JSON.stringify(pairs)));
  }
  return statements;
}

const cleanIds = (ids) => [...new Set((ids || []).map(Number))]
  .filter((id) => Number.isSafeInteger(id) && id > 0)
  .slice(0, SEARCH_SYNC_MAX_IDS);

async function reconcile(env, request, ids) {
  if (!(await isModuleOn(env, "search", request))) return;
  const visible = (await env.FORUM_DB.prepare(INDEXABLE_BY_IDS_SQL).bind(JSON.stringify(ids)).all()).results || [];
  const statements = ids.map((id) => env.SEARCH_DB.prepare(INDEX_DELETE_SQL).bind(id));
  await env.SEARCH_DB.batch([...statements, ...indexInsertStatements(env.SEARCH_DB, visible)]);
}

// Fire-and-forget. Returns the detached promise (always resolves) so tests
// can await it; callers must not await it on the request path.
export function syncSearchPosts(env, request, ids) {
  if (!env || !env.SEARCH_DB) return Promise.resolve();
  const clean = cleanIds(ids);
  if (clean.length === 0) return Promise.resolve();
  let task;
  try {
    task = reconcile(env, request, clean).catch((error) => {
      console.error("Search index sync failed (the write itself succeeded):", error);
    });
  } catch (error) {
    console.error("Search index sync failed (the write itself succeeded):", error);
    return Promise.resolve();
  }
  try {
    executionContexts.get(request)?.waitUntil?.(task);
  } catch (error) {
    console.error("Search index sync could not be scheduled:", error);
  }
  return task;
}
