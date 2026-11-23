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

// The search module (default off; docs/modules.md): full-text search of post
// bodies. The FTS5 index post_search lives in its own database (binding
// SEARCH_DB, migrations-search/) so the shared forum + Accounts database
// stays exportable; the module stays off without that binding.
//   GET  /api/search/full?q=&sort=&cursor=   anyone (the read tier + Anubis)
//   POST /api/search/backfill {after}        the owner: rebuild the index
// The module owns the /api/search/ prefix, so while it is off both answer 404
// before reaching here. The classic GET /api/search (members + threads) is a
// different, always-on route and is untouched. Write-path sync is in
// api/search-index.mjs.
//
// Read path: SEARCH_DB returns up to SEARCH_FTS_CANDIDATES ranked ids after
// the cursor; FORUM_DB loads those ids and keeps only what the viewer may
// see; the page is the first FEED_PAGE_SIZE survivors in rank order. The
// cursor continues the FTS ranking, so rows the visibility law filters out
// can make a page short (nextCursor still says whether to ask for more).
//
// Safety:
//   * The query is never handed to MATCH as typed. searchTerms() keeps only
//     runs of letters, digits and marks, and each run becomes one quoted
//     FTS5 string, so `"`, `*`, `:`, `^`, `-`, parentheses, NEAR, OR, AND and
//     NOT are plain words or separators, never operators.
//   * The visibility law is applied in FORUM_DB at read time, whatever the
//     index holds: a signed-in non-staff viewer goes through viewablePostSql
//     (post, parent and root public, unbanned, no block pair either way);
//     everyone else through publicChainSql. Staff get the public face too:
//     hidden posts are reachable only from the desk.
//   * The index holds spoiler-masked text, so a word inside a spoiler never
//     matches; the excerpt is cut from the CURRENT body after spoilers are
//     masked (maskSpoilers + maskedExcerpt); FTS5's snippet() is never used.
import {
  SEARCH_FTS_BACKFILL_BATCH, SEARCH_FTS_CANDIDATES, SEARCH_FTS_EXCERPT_CHARS, SEARCH_FTS_EXCERPT_LEAD,
  SEARCH_FTS_MAX_TERMS, SEARCH_FTS_QUERY_MAX_CHARS, SEARCH_FTS_TERM_MAX_CHARS, FEED_PAGE_SIZE,
} from "../constants.mjs";
import { readSession, requireAdmin } from "./core/auth.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { maskSpoilers, maskedExcerpt } from "./core/spoilers.mjs";
import { VIEWABLE_POST_BINDS, publicChainSql, viewablePostSql } from "./core/visibility.mjs";
import { indexInsertStatements } from "./search-index.mjs";

export const FULL_SEARCH_PATH = "/api/search/full";
export const FULL_SEARCH_BACKFILL_PATH = "/api/search/backfill";
export const FULL_SEARCH_SORTS = Object.freeze(["relevant", "new"]);

const TERM_RUN = /[\p{L}\p{N}\p{M}]+/gu;
const ID_CURSOR = /^[1-9][0-9]{0,14}$/;
const SCORE_CURSOR = /^(-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:e[+-]?[0-9]+)?)_([1-9][0-9]{0,14})$/;
const ELLIPSIS = "…";
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

const isStaff = (viewer) => Boolean(viewer && (viewer.role === "owner" || viewer.role === "admin"));
const capChars = (term) => Array.from(term).slice(0, SEARCH_FTS_TERM_MAX_CHARS).join("");

// The user's words as lower-case terms: letter/digit/mark runs only, each
// capped, duplicates dropped, in first-seen order. Never carries a quote.
export function searchTerms(raw) {
  const runs = String(raw ?? "").toLowerCase().match(TERM_RUN) || [];
  return [...new Set(runs.map(capChars))];
}

// The MATCH string: every term a quoted FTS5 string, joined by spaces (an
// implicit AND). Terms hold no `"` (searchTerms), so nothing can close one.
export const matchExpression = (terms) => terms.map((term) => `"${term}"`).join(" ");

// ?cursor= for the sort: "new" walks ids down; "relevant" walks
// (bm25 score up, id down). Anything else is a 400.
export function parseSearchCursor(raw, sort) {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw);
  if (sort === "new") {
    if (!ID_CURSOR.test(text)) throw new HttpError(400, "That page cursor is invalid.");
    return { id: Number(text) };
  }
  const match = text.match(SCORE_CURSOR);
  const score = match ? Number(match[1]) : NaN;
  if (!match || !Number.isFinite(score)) throw new HttpError(400, "That page cursor is invalid.");
  return { score, id: Number(match[2]) };
}

const encodeCursor = (row, sort) => (sort === "new" ? String(row.id) : String(row.score) + "_" + String(row.id));

// The excerpt: spoilers masked FIRST, then a window that starts a little
// before the first literal hit (or at the start), cut by maskedExcerpt.
export function searchExcerpt(body, terms) {
  const masked = maskSpoilers(String(body ?? ""));
  const lower = masked.toLowerCase();
  let hit = -1;
  if (lower.length === masked.length) {
    for (const term of terms) {
      const at = lower.indexOf(term);
      if (at !== -1 && (hit === -1 || at < hit)) hit = at;
    }
  }
  let start = hit > SEARCH_FTS_EXCERPT_LEAD ? hit - SEARCH_FTS_EXCERPT_LEAD : 0;
  const code = masked.charCodeAt(start);
  if (start > 0 && code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX) start -= 1;
  const cut = maskedExcerpt(masked.slice(start), SEARCH_FTS_EXCERPT_CHARS);
  return start > 0 ? ELLIPSIS + cut : cut;
}

// SEARCH_DB: up to SEARCH_FTS_CANDIDATES ranked ids after the cursor.
// Binds: the MATCH string, then the cursor (0, 1 or 3): at most 4.
export function candidateQuery(terms, sort, cursor) {
  const values = [matchExpression(terms)];
  let keyset = "";
  if (cursor && sort === "new") {
    keyset = " WHERE m.id < ?";
    values.push(cursor.id);
  } else if (cursor) {
    keyset = " WHERE (m.score > ? OR (m.score = ? AND m.id < ?))";
    values.push(cursor.score, cursor.score, cursor.id);
  }
  const order = sort === "new" ? "m.id DESC" : "m.score ASC, m.id DESC";
  const sql =
    "WITH m AS MATERIALIZED (SELECT rowid AS id, bm25(post_search) AS score FROM post_search " +
    "WHERE post_search MATCH ?) SELECT m.id, m.score FROM m" + keyset +
    " ORDER BY " + order + " LIMIT " + SEARCH_FTS_CANDIDATES;
  return { sql, values };
}

// FORUM_DB: the candidates the viewer may see. Binds: the JSON id list, then
// the viewer id VIEWABLE_POST_BINDS times (signed-in non-staff only): at
// most 7, far under D1_MAX_BOUND_PARAMS, at any candidate count.
export function visibleRowsQuery(ids, viewer) {
  const blockAware = Boolean(viewer && viewer.id) && !isStaff(viewer);
  const visible = blockAware ? viewablePostSql("p.id") : publicChainSql("p");
  const values = [JSON.stringify(ids)];
  if (blockAware) for (let i = 0; i < VIEWABLE_POST_BINDS; i++) values.push(Number(viewer.id));
  const sql =
    "SELECT p.id, p.parent_id, p.body, p.board, p.created_at, u.username AS author_username, " +
    "COALESCE((SELECT pp.parent_id FROM posts pp WHERE pp.id = p.parent_id), p.parent_id, p.id) AS thread_id " +
    "FROM json_each(?) j JOIN posts p ON p.id = j.value JOIN users u ON u.id = p.author_id WHERE " + visible;
  return { sql, values };
}

// Walk the candidates in rank order, keep the visible ones up to a page.
// nextCursor continues after the last candidate this page consumed, whenever
// more candidates may exist (the page filled early, or SEARCH_DB returned a
// full candidate batch): a short page with a cursor is normal.
export function assemblePage(candidates, visibleById, sort) {
  const page = [];
  let consumed = -1;
  for (let at = 0; at < candidates.length && page.length < FEED_PAGE_SIZE; at++) {
    consumed = at;
    const row = visibleById.get(Number(candidates[at].id));
    if (row) page.push({ ...row, score: candidates[at].score });
  }
  const more = consumed < candidates.length - 1 || candidates.length === SEARCH_FTS_CANDIDATES;
  const last = consumed >= 0 ? candidates[consumed] : null;
  return { page, nextCursor: more && last ? encodeCursor(last, sort) : null };
}

const shapeResult = (row, terms) => ({
  id: Number(row.id),
  threadId: Number(row.thread_id),
  parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
  board: row.board || "general",
  createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
  author: String(row.author_username ?? ""),
  excerpt: searchExcerpt(row.body, terms),
});

function readSort(params) {
  const sort = params.get("sort");
  if (sort === null) return FULL_SEARCH_SORTS[0];
  if (!FULL_SEARCH_SORTS.includes(sort)) throw new HttpError(400, "The sort param must be relevant or new.");
  return sort;
}

async function handleFullSearch(request, env, url) {
  await rateLimit(request, env, "full-search");
  const raw = (url.searchParams.get("q") || "").trim();
  if (raw.length > SEARCH_FTS_QUERY_MAX_CHARS) {
    throw new HttpError(400, "Search must be 1–100 characters long.");
  }
  const sort = readSort(url.searchParams);
  const cursor = parseSearchCursor(url.searchParams.get("cursor"), sort);
  const terms = searchTerms(raw);
  if (terms.length > SEARCH_FTS_MAX_TERMS) {
    throw new HttpError(400, "Search with " + SEARCH_FTS_MAX_TERMS + " words or fewer.");
  }
  if (terms.length === 0) return json({ terms: [], posts: [], nextCursor: null });
  const session = await readSession(request, env);
  const viewer = session && session.user ? session.user : null;
  const ranked = candidateQuery(terms, sort, cursor);
  const candidates = (await env.SEARCH_DB.prepare(ranked.sql).bind(...ranked.values).all()).results || [];
  if (candidates.length === 0) return json({ terms, posts: [], nextCursor: null });
  const lookup = visibleRowsQuery(candidates.map((row) => Number(row.id)), viewer);
  const rows = (await env.FORUM_DB.prepare(lookup.sql).bind(...lookup.values).all()).results || [];
  const { page, nextCursor } = assemblePage(candidates, new Map(rows.map((row) => [Number(row.id), row])), sort);
  return json({ terms, posts: page.map((row) => shapeResult(row, terms)), nextCursor });
}

// The owner's rebuild: for the next SEARCH_FTS_BACKFILL_BATCH post ids above
// `after`, the index range (after, last] is cleared and refilled with the
// spoiler-masked bodies of the posts that are publicly visible now, so ids
// that were deleted, hidden or banned since are pruned. The last call also
// prunes every index row above the newest post. Idempotent: run it again any
// time. The client repeats it with the returned `after` until `done`.
export const BACKFILL_IDS_SQL = "SELECT id FROM posts WHERE id > ? ORDER BY id LIMIT " + SEARCH_FTS_BACKFILL_BATCH;
export const BACKFILL_ROWS_SQL =
  "SELECT p.id, p.body FROM posts p WHERE p.id > ? AND p.id <= ? AND " + publicChainSql("p");
export const BACKFILL_CLEAR_RANGE_SQL = "DELETE FROM post_search WHERE rowid > ? AND rowid <= ?";
export const BACKFILL_CLEAR_TAIL_SQL = "DELETE FROM post_search WHERE rowid > ?";

function readAfter(body) {
  const after = body && typeof body === "object" && body.after !== undefined ? body.after : 0;
  if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, "The after value must be a whole number.");
  return after;
}

async function handleBackfill(request, env) {
  const { user } = await requireAdmin(request, env);
  await rateLimit(request, env, "write", String(user.id));
  const after = readAfter(await readJson(request));
  const ids = (await env.FORUM_DB.prepare(BACKFILL_IDS_SQL).bind(after).all()).results || [];
  if (ids.length === 0) {
    await env.SEARCH_DB.prepare(BACKFILL_CLEAR_TAIL_SQL).bind(after).run();
    return json({ indexed: 0, after, done: true });
  }
  const last = Number(ids[ids.length - 1].id);
  const done = ids.length < SEARCH_FTS_BACKFILL_BATCH;
  const rows = (await env.FORUM_DB.prepare(BACKFILL_ROWS_SQL).bind(after, last).all()).results || [];
  const search = env.SEARCH_DB;
  await search.batch([
    search.prepare(BACKFILL_CLEAR_RANGE_SQL).bind(after, last),
    ...(done ? [search.prepare(BACKFILL_CLEAR_TAIL_SQL).bind(last)] : []),
    ...indexInsertStatements(search, rows),
  ]);
  return json({ indexed: rows.length, after: last, done });
}

export async function handleFullSearchRoutes(request, env, url, path, method) {
  if (path === FULL_SEARCH_PATH) {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    return handleFullSearch(request, env, url);
  }
  if (path === FULL_SEARCH_BACKFILL_PATH) {
    if (method !== "POST") throw new HttpError(405, "That method is not supported.");
    return handleBackfill(request, env);
  }
  return undefined;
}
