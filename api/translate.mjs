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

// The translate module, P1 (docs/translating.md; slate 2026-11-22-translate).
// The module gate (api/core/modules.mjs, default off) answers 404 for every
// /api/translate path before this handler runs.
//   GET    /api/translate/progress                     anyone: done/total per locale
//   GET    /api/translate/:locale/keys?filter&q&cursor anyone: keys, English, current
//                                                      value; members also get counts
//   GET    /api/translate/:locale/:key/suggestions     signed in: pending rows (visibility law)
//   POST   /api/translate/:locale/:key/suggestions     member, not banned (CSRF, rate limit)
//   DELETE /api/translate/suggestions/:id              the author: withdraw own pending row
//   GET    /api/translate/review?locale&cursor         staff: the queue
//   POST   /api/translate/suggestions/:id/review       staff: {action: approve|reject, note?}
// The shipped public/locales/*.json (read through ASSETS) are the source of
// truth; nothing here writes them. The owner's scripts/translate-export.mjs
// reads approved rows and merges them into the files off-worker.
import {
  TRANSLATE_NOTE_MAX_CHARS, TRANSLATE_PAGE_SIZE, TRANSLATE_PENDING_PER_KEY_MAX, TRANSLATE_PENDING_PER_MEMBER_MAX,
  TRANSLATE_PRUNE_BATCH, TRANSLATE_REJECTED_RETENTION_DAYS, TRANSLATE_REVIEW_PAGE_SIZE, TRANSLATE_SEARCH_MAX_CHARS,
} from "../constants.mjs";
import { assertNotBanned, readSession, requireSignedInRead, requireStaff, requireUser } from "./core/auth.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { sha256Hex } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requireMutationApplied } from "./core/http.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";
import { containsFilteredWord } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import {
  SOURCE_LOCALE, TRANSLATABLE_LOCALES, TRANSLATE_KEY_PATTERN, TRANSLATE_VALUE_HARD_MAX, isExtraPluralKey, isMissing,
  suggestionProblem, translatableLocale, translateValueMax,
} from "../public/js/translate-validate.js";

const DAY_SECONDS = 86400;
const STAFF_ROLES = new Set(["owner", "admin"]);
const FILTERS = new Set(["all", "missing", "mine"]);
const LOCALE_SEGMENT = "([A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?)";
const KEYS_ROUTE = new RegExp("^/api/translate/" + LOCALE_SEGMENT + "/keys$");
const SUGGESTIONS_ROUTE = new RegExp("^/api/translate/" + LOCALE_SEGMENT + "/([a-z][A-Za-z0-9.]{2,119})/suggestions$");
const WITHDRAW_ROUTE = /^\/api\/translate\/suggestions\/([1-9][0-9]{0,14})$/;
const REVIEW_ROUTE = /^\/api\/translate\/suggestions\/([1-9][0-9]{0,14})\/review$/;

// The English the client falls back to; the browser paints
// translate.error.<reason> from en.json (the same text).
const MESSAGES = Object.freeze({
  placeholders: "Use exactly the same placeholders as the English text.",
  plural: "Only the plural forms the English text has can be translated.",
  tooLong: "Keep it to {max} characters or fewer.",
  copyOfEnglish: "That is the same as the English text.",
  markup: "Use plain text only: no tags, entities, line breaks or hidden direction marks.",
  filtered: "That text contains a word this forum filters.",
  stale: "The English text changed. Reload and try again.",
  duplicate: "That suggestion is already waiting for review.",
  limit: "Too many of your suggestions are waiting. Try again after some are reviewed.",
});
const refuse = (status, reason, extra = {}) => {
  const message = MESSAGES[reason].replace("{max}", String(extra.max ?? ""));
  return new HttpError(status, message, {}, { error: message, reason, ...extra });
};
const notFound = () => new HttpError(404, "Not found.");

const PENDING = "status = 'pending'";
const SUGGESTION_COLUMNS = "s.id, s.value, s.source_hash, s.credit, s.user_id, u.username";
export const TRANSLATE_SQL = Object.freeze({
  pendingCounts: "SELECT msg_key, COUNT(*) AS n FROM translate_suggestions WHERE locale = ? AND " + PENDING +
    " AND msg_key IN (SELECT value FROM json_each(?)) GROUP BY msg_key",
  mineKeys: "SELECT msg_key FROM translate_suggestions WHERE locale = ? AND user_id = ? AND " + PENDING +
    " LIMIT " + TRANSLATE_PENDING_PER_MEMBER_MAX,
  // Members: no actively banned author, no block pair (2 binds via the helper).
  keySuggestions: "SELECT " + SUGGESTION_COLUMNS + " FROM translate_suggestions s JOIN users u ON u.id = s.user_id " +
    "WHERE s.locale = ? AND s.msg_key = ? AND s." + PENDING + " AND NOT " + ACTIVE_BAN_SQL("s.user_id") +
    viewerBlockFilterSql({ id: 1, role: "member" }, "s.user_id") + " ORDER BY s.id LIMIT " + TRANSLATE_PENDING_PER_KEY_MAX,
  keySuggestionsStaff: "SELECT " + SUGGESTION_COLUMNS + " FROM translate_suggestions s JOIN users u ON u.id = s.user_id " +
    "WHERE s.locale = ? AND s.msg_key = ? AND s." + PENDING + " ORDER BY s.id LIMIT " + TRANSLATE_PENDING_PER_KEY_MAX,
  preflight: "SELECT (SELECT COUNT(*) FROM translate_suggestions WHERE user_id = ? AND " + PENDING + ") AS mine, " +
    "(SELECT COUNT(*) FROM translate_suggestions WHERE locale = ? AND msg_key = ? AND " + PENDING + ") AS on_key, " +
    "EXISTS (SELECT 1 FROM translate_suggestions WHERE locale = ? AND msg_key = ? AND " + PENDING +
    " AND (value = ? OR user_id = ?)) AS dup",
  // Guarded insert: still an unbanned member under the per-member cap.
  insert: "INSERT INTO translate_suggestions (locale, msg_key, source_hash, value, user_id, credit, created_day) " +
    "SELECT ?, ?, ?, ?, u.id, ?, ? FROM users u WHERE u.id = ? AND NOT " + ACTIVE_BAN_SQL("u.id") +
    " AND (SELECT COUNT(*) FROM translate_suggestions t WHERE t.user_id = u.id AND t." + PENDING + ") < " +
    TRANSLATE_PENDING_PER_MEMBER_MAX,
  withdraw: "DELETE FROM translate_suggestions WHERE id = ? AND user_id = ? AND " + PENDING,
  row: "SELECT id, locale, msg_key, source_hash, status FROM translate_suggestions WHERE id = ?",
  approve: "UPDATE translate_suggestions SET status = 'approved', reviewer_id = ?, reviewed_day = ?, review_note = ? " +
    "WHERE id = ? AND " + PENDING + " AND source_hash = ?",
  supersede: "UPDATE translate_suggestions SET status = 'rejected', reviewer_id = ?, reviewed_day = ?, " +
    "review_note = 'superseded' WHERE locale = ? AND msg_key = ? AND " + PENDING + " AND id <> ? " +
    "AND EXISTS (SELECT 1 FROM translate_suggestions a WHERE a.id = ? AND a.status = 'approved')",
  reject: "UPDATE translate_suggestions SET status = 'rejected', reviewer_id = ?, reviewed_day = ?, review_note = ? " +
    "WHERE id = ? AND " + PENDING,
  prune: "DELETE FROM translate_suggestions WHERE id IN (SELECT id FROM translate_suggestions " +
    "WHERE status = 'rejected' AND reviewed_day < ? ORDER BY id LIMIT " + TRANSLATE_PRUNE_BATCH + ")",
  queue: "SELECT s.id, s.locale, s.msg_key, s.value, s.source_hash, s.credit, u.username, " +
    ACTIVE_BAN_SQL("s.user_id") + " AS banned FROM translate_suggestions s JOIN users u ON u.id = s.user_id " +
    "WHERE s." + PENDING + " AND s.id > ? ORDER BY s.id LIMIT ?",
  queueLocale: "SELECT s.id, s.locale, s.msg_key, s.value, s.source_hash, s.credit, u.username, " +
    ACTIVE_BAN_SQL("s.user_id") + " AS banned FROM translate_suggestions s JOIN users u ON u.id = s.user_id " +
    "WHERE s." + PENDING + " AND s.locale = ? AND s.id > ? ORDER BY s.id LIMIT ?",
});

const utcDay = () => Math.floor(Date.now() / 1000 / DAY_SECONDS);
const isStaff = (user) => Boolean(user && STAFF_ROLES.has(user.role));

// ---- the shipped tables (per isolate, cleared by a deploy's new stamp) ------

const tableCaches = new WeakMap();
const progressCaches = new WeakMap();
const deployStamp = (env) => String(env.VERSION ?? "") + "@" + String(env.COMMIT_SHA ?? "");

async function fetchTable(env, code) {
  const response = await env.ASSETS.fetch(new Request("https://assets.invalid/locales/" + code + ".json"));
  const data = response.ok ? await response.json().catch(() => null) : null;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(503, "The translation tables could not be read.");
  }
  return Object.freeze(Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === "string")));
}

function loadTable(env, code) {
  if (!env.ASSETS) throw new HttpError(503, "Static assets are not configured.");
  let cache = tableCaches.get(env.ASSETS);
  if (!cache || cache.stamp !== deployStamp(env)) {
    cache = { stamp: deployStamp(env), tables: new Map() };
    tableCaches.set(env.ASSETS, cache);
  }
  if (!cache.tables.has(code)) {
    const pending = fetchTable(env, code);
    pending.catch(() => cache.tables.delete(code));
    cache.tables.set(code, pending);
  }
  return cache.tables.get(code);
}

function localeOr404(code) {
  const locale = translatableLocale(code);
  if (!locale) throw notFound();
  return locale;
}

// ---- reads ------------------------------------------------------------------

async function computeProgress(env) {
  const en = await loadTable(env, SOURCE_LOCALE);
  const keys = Object.keys(en);
  const tables = await Promise.all(TRANSLATABLE_LOCALES.map((locale) => loadTable(env, locale.code)));
  return TRANSLATABLE_LOCALES.map((locale, index) => {
    const done = keys.filter((key) => key in tables[index] && !isMissing(key, tables[index][key], en[key])).length;
    return {
      code: locale.code, name: locale.name, dir: locale.dir, done, total: keys.length,
      percent: keys.length ? Math.floor((done / keys.length) * 100) : 0,
    };
  });
}

async function readProgress(request, env) {
  await rateLimit(request, env, "read");
  let cache = progressCaches.get(env.ASSETS ?? progressCaches);
  if (!cache || cache.stamp !== deployStamp(env)) {
    cache = { stamp: deployStamp(env), value: computeProgress(env) };
    cache.value.catch(() => progressCaches.delete(env.ASSETS));
    if (env.ASSETS) progressCaches.set(env.ASSETS, cache);
  }
  return json({ locales: await cache.value }, 200, { "Cache-Control": "public, max-age=300" });
}

async function pendingCounts(env, code, keys) {
  if (!keys.length) return new Map();
  const { results } = await env.FORUM_DB.prepare(TRANSLATE_SQL.pendingCounts).bind(code, JSON.stringify(keys)).all();
  return new Map((results || []).map((row) => [row.msg_key, Number(row.n)]));
}

function keysParams(url) {
  const filter = url.searchParams.get("filter") || "all";
  const cursor = Number(url.searchParams.get("cursor") || 0);
  const q = String(url.searchParams.get("q") || "").trim().toLocaleLowerCase().slice(0, TRANSLATE_SEARCH_MAX_CHARS);
  if (!FILTERS.has(filter) || !Number.isSafeInteger(cursor) || cursor < 0) {
    throw new HttpError(400, "That page cursor is invalid.");
  }
  return { filter, cursor, q };
}

async function readKeys(request, env, url, code) {
  const locale = localeOr404(code);
  const { filter, cursor, q } = keysParams(url);
  const session = await readSession(request, env);
  const user = session?.user ?? null;
  await rateLimit(request, env, "read");
  if (filter === "mine" && !user) throw new HttpError(401, "Please sign in to do that.");
  const [en, table] = await Promise.all([loadTable(env, SOURCE_LOCALE), loadTable(env, locale.code)]);
  let mine = null;
  if (filter === "mine") {
    const { results } = await env.FORUM_DB.prepare(TRANSLATE_SQL.mineKeys).bind(locale.code, user.id).all();
    mine = new Set((results || []).map((row) => row.msg_key));
  }
  const matches = Object.keys(en).filter((key) => {
    const value = table[key] ?? en[key];
    if (filter === "missing" && !isMissing(key, value, en[key])) return false;
    if (mine && !mine.has(key)) return false;
    return !q || key.toLocaleLowerCase().includes(q) || en[key].toLocaleLowerCase().includes(q) ||
      value.toLocaleLowerCase().includes(q);
  });
  const page = matches.slice(cursor, cursor + TRANSLATE_PAGE_SIZE);
  const counts = user ? await pendingCounts(env, locale.code, page) : null;
  const items = await Promise.all(page.map(async (key) => {
    const value = table[key] ?? en[key];
    const item = { key, source: en[key], sourceHash: await sha256Hex(en[key]), value, missing: isMissing(key, value, en[key]) };
    return counts ? { ...item, pending: counts.get(key) ?? 0 } : item;
  }));
  const next = cursor + TRANSLATE_PAGE_SIZE;
  return json({
    locale: locale.code, dir: locale.dir, total: matches.length, items, nextCursor: next < matches.length ? next : null,
  }, 200, { "Cache-Control": "no-store" });
}

async function sourceFor(env, key) {
  if (!TRANSLATE_KEY_PATTERN.test(key)) throw notFound();
  const en = await loadTable(env, SOURCE_LOCALE);
  if (!Object.hasOwn(en, key)) throw notFound();
  return en[key];
}

async function readKeySuggestions(request, env, code, key) {
  const locale = localeOr404(code);
  const { user } = await requireSignedInRead(request, env);
  await rateLimit(request, env, "read");
  const source = await sourceFor(env, key);
  const hash = await sha256Hex(source);
  const staffView = isStaff(user);
  const statement = staffView
    ? env.FORUM_DB.prepare(TRANSLATE_SQL.keySuggestionsStaff).bind(locale.code, key)
    : env.FORUM_DB.prepare(TRANSLATE_SQL.keySuggestions).bind(locale.code, key, user.id, user.id);
  const { results } = await statement.all();
  const items = (results || []).map((row) => ({
    id: Number(row.id),
    value: row.value,
    // Credit is opt-in: "a member" (null) unless the author chose to be named.
    // Staff always see the author (moderation).
    author: staffView || Number(row.credit) === 1 ? row.username : null,
    mine: Number(row.user_id) === Number(user.id),
    stale: row.source_hash !== hash,
  }));
  return json({ items }, 200, { "Cache-Control": "no-store" });
}

async function readQueue(request, env, url) {
  await requireStaff(request, env, false);
  await rateLimit(request, env, "read");
  const code = url.searchParams.get("locale");
  const cursor = Number(url.searchParams.get("cursor") || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, "That page cursor is invalid.");
  const statement = code
    ? env.FORUM_DB.prepare(TRANSLATE_SQL.queueLocale).bind(localeOr404(code).code, cursor, TRANSLATE_REVIEW_PAGE_SIZE + 1)
    : env.FORUM_DB.prepare(TRANSLATE_SQL.queue).bind(cursor, TRANSLATE_REVIEW_PAGE_SIZE + 1);
  const { results } = await statement.all();
  const rows = (results || []).slice(0, TRANSLATE_REVIEW_PAGE_SIZE);
  const en = await loadTable(env, SOURCE_LOCALE);
  const items = await Promise.all(rows.map(async (row) => {
    const source = Object.hasOwn(en, row.msg_key) ? en[row.msg_key] : null;
    return {
      id: Number(row.id), locale: row.locale, key: row.msg_key, value: row.value, source,
      author: row.username, authorBanned: Number(row.banned) === 1, credit: Number(row.credit) === 1,
      stale: source === null || row.source_hash !== await sha256Hex(source),
    };
  }));
  const more = (results || []).length > TRANSLATE_REVIEW_PAGE_SIZE;
  return json({ items, nextCursor: more ? items.at(-1).id : null }, 200, { "Cache-Control": "no-store" });
}

// ---- writes -----------------------------------------------------------------

async function createSuggestion(request, env, code, key) {
  const locale = localeOr404(code);
  const { user } = await requireUser(request, env);
  await assertNotBanned(env, user.id);
  await rateLimit(request, env, "translate", String(user.id));
  if (isExtraPluralKey(key)) throw refuse(422, "plural");
  const source = await sourceFor(env, key);
  const body = await readJson(request);
  const value = typeof body?.value === "string" ? body.value : "";
  if (typeof body?.sourceHash !== "string" || body.sourceHash !== await sha256Hex(source)) throw refuse(409, "stale");
  const problem = suggestionProblem({ key, value, source });
  if (problem === "empty") throw new HttpError(400, "Write something first.");
  if (problem === "tooLong" || [...value].length > TRANSLATE_VALUE_HARD_MAX) {
    throw refuse(422, "tooLong", { max: translateValueMax(source) });
  }
  if (problem) throw refuse(422, problem);
  if (containsFilteredWord(value, filterWords(env))) throw refuse(422, "filtered");
  const checks = await env.FORUM_DB.prepare(TRANSLATE_SQL.preflight)
    .bind(user.id, locale.code, key, locale.code, key, value, user.id).first();
  if (Number(checks?.dup) === 1) throw refuse(409, "duplicate");
  if (Number(checks?.mine) >= TRANSLATE_PENDING_PER_MEMBER_MAX || Number(checks?.on_key) >= TRANSLATE_PENDING_PER_KEY_MAX) {
    throw refuse(409, "limit");
  }
  let result;
  try {
    result = await env.FORUM_DB.prepare(TRANSLATE_SQL.insert)
      .bind(locale.code, key, await sha256Hex(source), value, body.credit === true ? 1 : 0, utcDay(), user.id).run();
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message))) throw refuse(409, "duplicate");
    throw error;
  }
  if (Number(result?.meta?.changes) !== 1) {
    await assertNotBanned(env, user.id);
    throw refuse(409, "limit");
  }
  return json({ suggestion: { id: Number(result.meta.last_row_id), value, mine: true, stale: false } }, 201);
}

async function withdrawSuggestion(request, env, id) {
  const { user } = await requireUser(request, env);
  await rateLimit(request, env, "translate", String(user.id));
  const result = await env.FORUM_DB.prepare(TRANSLATE_SQL.withdraw).bind(id, user.id).run();
  if (Number(result?.meta?.changes) !== 1) throw notFound();
  return json({ withdrawn: true });
}

function parseReview(body) {
  const action = body?.action;
  if (action !== "approve" && action !== "reject") throw new HttpError(400, "Choose approve or reject.");
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > TRANSLATE_NOTE_MAX_CHARS) throw new HttpError(400, "Keep the note to 200 characters or fewer.");
  return { action, note: note || null };
}

async function reviewSuggestion(request, env, id) {
  const { user } = await requireStaff(request, env);
  await rateLimit(request, env, "translate", String(user.id));
  const { action, note } = parseReview(await readJson(request));
  const row = await env.FORUM_DB.prepare(TRANSLATE_SQL.row).bind(id).first();
  if (!row || row.status !== "pending") throw notFound();
  const day = utcDay();
  const prune = env.FORUM_DB.prepare(TRANSLATE_SQL.prune).bind(day - TRANSLATE_REJECTED_RETENTION_DAYS);
  if (action === "reject") {
    const [result] = await env.FORUM_DB.batch([
      env.FORUM_DB.prepare(TRANSLATE_SQL.reject).bind(user.id, day, note, id), prune,
    ]);
    requireMutationApplied(result);
    return json({ reviewed: true, status: "rejected", superseded: 0 });
  }
  const en = await loadTable(env, SOURCE_LOCALE);
  const hash = Object.hasOwn(en, row.msg_key) ? await sha256Hex(en[row.msg_key]) : null;
  if (hash === null || row.source_hash !== hash) throw refuse(409, "stale");
  const [approved, superseded] = await env.FORUM_DB.batch([
    env.FORUM_DB.prepare(TRANSLATE_SQL.approve).bind(user.id, day, note, id, hash),
    env.FORUM_DB.prepare(TRANSLATE_SQL.supersede).bind(user.id, day, row.locale, row.msg_key, id, id),
    prune,
  ]);
  if (Number(approved?.meta?.changes) !== 1) throw notFound();
  return json({ reviewed: true, status: "approved", superseded: Number(superseded?.meta?.changes ?? 0) });
}

// ---- dispatch ---------------------------------------------------------------

const methodNotSupported = () => new HttpError(405, "That method is not supported.");

export async function handleTranslateRoutes(request, env, url, path, method) {
  if (!path.startsWith("/api/translate/")) return null;
  if (path === "/api/translate/progress") {
    if (method !== "GET") throw methodNotSupported();
    return readProgress(request, env);
  }
  if (path === "/api/translate/review") {
    if (method !== "GET") throw methodNotSupported();
    return readQueue(request, env, url);
  }
  let match = path.match(REVIEW_ROUTE);
  if (match) {
    if (method !== "POST") throw methodNotSupported();
    return reviewSuggestion(request, env, Number(match[1]));
  }
  match = path.match(WITHDRAW_ROUTE);
  if (match) {
    if (method !== "DELETE") throw methodNotSupported();
    return withdrawSuggestion(request, env, Number(match[1]));
  }
  match = path.match(KEYS_ROUTE);
  if (match) {
    if (method !== "GET") throw methodNotSupported();
    return readKeys(request, env, url, match[1]);
  }
  match = path.match(SUGGESTIONS_ROUTE);
  if (match) {
    if (method === "GET") return readKeySuggestions(request, env, match[1], match[2]);
    if (method === "POST") return createSuggestion(request, env, match[1], match[2]);
    throw methodNotSupported();
  }
  return null;
}
