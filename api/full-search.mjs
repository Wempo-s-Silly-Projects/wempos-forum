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

// The search module (default off; docs/modules.md, migration 0097): full-text
// search of post bodies through D1's FTS5 index post_search.
//   GET  /api/search/full?q=&sort=&cursor=   anyone (the read tier + Anubis)
//   POST /api/search/backfill {after}        the owner: index older posts
// The module owns the /api/search/ prefix, so while it is off both answer 404
// before reaching here. The classic GET /api/search (members + threads) is a
// different, always-on route and is untouched.
//
// Safety:
//   * The query is never handed to MATCH as typed. searchTerms() keeps only
//     runs of letters, digits and marks, and each run becomes one quoted
//     FTS5 string, so `"`, `*`, `:`, `^`, `-`, parentheses, NEAR, OR, AND and
//     NOT are plain words or separators, never operators.
//   * The visibility law is applied at read time, whatever the index holds:
//     a signed-in non-staff viewer goes through viewablePostSql (post, parent
//     and root public, unbanned, no block pair either way); everyone else
//     through publicChainSql. Staff get the public face too: hidden posts are
//     reachable only from the desk.
//   * The excerpt is cut from the CURRENT body after spoilers are masked
//     (maskSpoilers + maskedExcerpt); FTS5's snippet() is never used.
import {
  SEARCH_FTS_BACKFILL_BATCH, SEARCH_FTS_EXCERPT_CHARS, SEARCH_FTS_EXCERPT_LEAD, SEARCH_FTS_MAX_TERMS,
  SEARCH_FTS_QUERY_MAX_CHARS, SEARCH_FTS_TERM_MAX_CHARS, FEED_PAGE_SIZE,
} from "../constants.mjs";
import { readSession, requireAdmin } from "./core/auth.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { maskSpoilers, maskedExcerpt } from "./core/spoilers.mjs";
import { VIEWABLE_POST_BINDS, publicChainSql, viewablePostSql } from "./core/visibility.mjs";

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

// One page of matches the viewer may see. Binds: the MATCH string, the
// viewer id VIEWABLE_POST_BINDS times (signed-in non-staff only), then the
// cursor (1 or 3): at most 10, far under D1_MAX_BOUND_PARAMS.
export function fullSearchQuery(terms, viewer, sort, cursor) {
  const blockAware = Boolean(viewer && viewer.id) && !isStaff(viewer);
  const visible = blockAware ? viewablePostSql("p.id") : publicChainSql("p");
  const values = [matchExpression(terms)];
  if (blockAware) for (let i = 0; i < VIEWABLE_POST_BINDS; i++) values.push(Number(viewer.id));
  let keyset = "";
  if (cursor && sort === "new") {
    keyset = " AND m.id < ?";
    values.push(cursor.id);
  } else if (cursor) {
    keyset = " AND (m.score > ? OR (m.score = ? AND m.id < ?))";
    values.push(cursor.score, cursor.score, cursor.id);
  }
  const order = sort === "new" ? "m.id DESC" : "m.score ASC, m.id DESC";
  const sql =
    "WITH m AS MATERIALIZED (SELECT rowid AS id, bm25(post_search) AS score FROM post_search " +
    "WHERE post_search MATCH ?) " +
    "SELECT m.id, m.score, p.parent_id, p.body, p.board, p.created_at, u.username AS author_username, " +
    "COALESCE((SELECT pp.parent_id FROM posts pp WHERE pp.id = p.parent_id), p.parent_id, p.id) AS thread_id " +
    "FROM m JOIN posts p ON p.id = m.id JOIN users u ON u.id = p.author_id " +
    "WHERE " + visible + keyset + " ORDER BY " + order + " LIMIT " + (FEED_PAGE_SIZE + 1);
  return { sql, values };
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
  const { sql, values } = fullSearchQuery(terms, viewer, sort, cursor);
  const rows = (await env.FORUM_DB.prepare(sql).bind(...values).all()).results || [];
  const page = rows.slice(0, FEED_PAGE_SIZE);
  return json({
    terms,
    posts: page.map((row) => shapeResult(row, terms)),
    nextCursor: rows.length > FEED_PAGE_SIZE ? encodeCursor(page[page.length - 1], sort) : null,
  });
}

// The owner's backfill: indexes the next SEARCH_FTS_BACKFILL_BATCH posts with
// an id above `after` that are not indexed yet (2 binds). Idempotent: rows
// the triggers or an earlier pass already indexed are skipped. The client
// repeats it with the returned `after` until `done`.
export const BACKFILL_IDS_SQL = "SELECT id FROM posts WHERE id > ? ORDER BY id LIMIT " + SEARCH_FTS_BACKFILL_BATCH;
export const BACKFILL_INSERT_SQL =
  "INSERT INTO post_search (rowid, body) SELECT p.id, p.body FROM posts p WHERE p.id > ? AND p.id <= ? " +
  "AND NOT EXISTS (SELECT 1 FROM post_search s WHERE s.rowid = p.id)";

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
  if (ids.length === 0) return json({ indexed: 0, after, done: true });
  const last = Number(ids[ids.length - 1].id);
  const result = await env.FORUM_DB.prepare(BACKFILL_INSERT_SQL).bind(after, last).run();
  return json({
    indexed: Number(result?.meta?.changes ?? 0),
    after: last,
    done: ids.length < SEARCH_FTS_BACKFILL_BATCH,
  });
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
