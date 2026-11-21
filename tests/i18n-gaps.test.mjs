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
// Wave 2026-11-21-3 F1: i18n gap closure — stable error codes, logical CSS
// properties for rtl locales, and locale-aware relative times/durations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { HttpError } from "../api/core/http.mjs";
import { ERROR_CODES, codedErrorReply, errorCodeFor } from "../api/core/error-codes.mjs";
import { errorKeyFor, errorMessageFor } from "../public/js/api.js";
import { formatDuration, formatRelative } from "../public/js/reltime.js";
import { formatBanCountdown } from "../public/js/banned.js";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, seedUser } from "./helpers/seed.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const en = JSON.parse(read("public/locales/en.json"));
const apiSource = readdirSync(new URL("../api/", import.meta.url))
  .filter((name) => name.endsWith(".mjs")).map((name) => read(`api/${name}`))
  .concat(readdirSync(new URL("../api/core/", import.meta.url))
    .filter((name) => name.endsWith(".mjs")).map((name) => read(`api/core/${name}`)))
  .concat(read("api/vendor/http.mjs"))
  .join("\n");

// --- F1a: stable error codes -------------------------------------------------

test("error-code table: snake_case codes, unique messages, each message still thrown verbatim", () => {
  const entries = Object.entries(ERROR_CODES);
  assert.ok(entries.length >= 40, `only ${entries.length} codes`);
  assert.equal(new Set(entries.map(([, message]) => message)).size, entries.length);
  for (const [code, message] of entries) {
    assert.match(code, /^[a-z][a-z0-9_]*$/, code);
    assert.ok(apiSource.includes(JSON.stringify(message)), `${code}: "${message}" no longer in api/`);
  }
});

test("every error code has its camelCase errors.* key in en.json carrying the same English text", () => {
  assert.equal(errorKeyFor("post_not_found"), "errors.postNotFound");
  for (const [code, message] of Object.entries(ERROR_CODES)) {
    assert.equal(en[errorKeyFor(code)], message, errorKeyFor(code));
  }
});

test("errorCodeFor maps known text, ignores unknown text", () => {
  assert.equal(errorCodeFor("Post not found."), "post_not_found");
  assert.equal(errorCodeFor("Some brand new message."), null);
  assert.equal(errorCodeFor(undefined), null);
});

test("codedErrorReply: coded HttpError adds code beside error; others unchanged", async () => {
  const coded = codedErrorReply(new HttpError(404, "Post not found."), "t:");
  assert.equal(coded.status, 404);
  assert.deepEqual(await coded.json(), { error: "Post not found.", code: "post_not_found" });
  const plain = codedErrorReply(new HttpError(400, "Something unmapped."), "t:");
  assert.deepEqual(await plain.json(), { error: "Something unmapped." });
  const payload = codedErrorReply(new HttpError(403, "Post not found.", {}, { error: "x", banned: true }), "t:");
  assert.deepEqual(await payload.json(), { error: "x", banned: true });
  const headers = codedErrorReply(new HttpError(429, ERROR_CODES.rate_limited, { "Retry-After": "7" }), "t:");
  assert.equal(headers.headers.get("Retry-After"), "7");
  const original = console.error;
  console.error = () => {};
  try {
    const crash = codedErrorReply(new Error("boom"), "t:");
    assert.equal(crash.status, 500);
    assert.equal((await crash.json()).code, undefined);
  } finally {
    console.error = original;
  }
});

test("the worker's /api responses carry the code (404 post, 429 limiter)", async () => {
  const env = makeEnv();
  const missing = await call(env, "/api/posts/987654");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Post not found.", code: "post_not_found" });
  const limited = makeEnv({ ...makeLimiters(false).bindings });
  const member = await seedUser(limited.__sqlite, { username: "Limited" });
  const target = await seedUser(limited.__sqlite, { username: "Target" });
  const session = forgeSession(limited.__sqlite, member);
  const response = await call(limited, `/api/users/${target}/block`, { method: "POST", session });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, "rate_limited");
});

test("worker.mjs routes /api errors through codedErrorReply, /mcp keeps the vendor reply", () => {
  const worker = read("worker.mjs");
  assert.match(worker, /return codedErrorReply\(error, "Forum request failed:"\)/);
  assert.match(worker, /return errorReply\(error, "MCP request failed:"\)/);
});

test("client: errorMessageFor prefers errors.<code>, falls back to the server text, then status", () => {
  const table = { "errors.postNotFound": "Beitrag nicht gefunden.", "api.requestFailed": "failed {status}" };
  const translate = (key, vars) => (key in table ? table[key].replace("{status}", vars?.status) : key);
  assert.equal(errorMessageFor({ error: "Post not found.", code: "post_not_found" }, 404, translate), "Beitrag nicht gefunden.");
  assert.equal(errorMessageFor({ error: "Unmapped.", code: "nope" }, 400, translate), "Unmapped.");
  assert.equal(errorMessageFor({ error: "Plain." }, 400, translate), "Plain.");
  assert.equal(errorMessageFor(null, 502, translate), "failed 502");
  assert.equal(errorMessageFor({ code: "__proto__" }, 400, translate), "failed 400");
});

// --- F1b: logical CSS properties -----------------------------------------------

test("css: no asymmetric physical left/right rules remain (rtl mirrors)", () => {
  const problems = [];
  for (const file of ["public/styles.css", "public/responsive.css"]) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const block of css.split("}")) {
      const physical = /(?:^|[;{\s])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:|text-align\s*:\s*(?:left|right)\b|float\s*:\s*(?:left|right)\b/g;
      for (const match of block.matchAll(physical)) problems.push(`${file}: ${match[0].trim()}`);
      const left = /(?:^|[;{\s])left\s*:\s*([^;]+);/.exec(block)?.[1]?.trim();
      const right = /(?:^|[;{\s])right\s*:\s*([^;]+);/.exec(block)?.[1]?.trim();
      const symmetric = left !== undefined && left === right;
      const centered = left === "50%" && right === undefined;
      if ((left !== undefined || right !== undefined) && !symmetric && !centered) {
        problems.push(`${file}: left:${left ?? "-"} right:${right ?? "-"}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

// --- F1c: locale-aware times ---------------------------------------------------

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

test("formatDuration: drops leading zero units, keeps hours once days show, always minutes", () => {
  assert.equal(formatDuration(3 * DAY + 2 * HOUR + 14 * MINUTE, "en"), "3d 2h 14m");
  assert.equal(formatDuration(2 * HOUR + 5 * MINUTE, "en"), "2h 5m");
  assert.equal(formatDuration(DAY + 5 * MINUTE, "en"), "1d 0h 5m");
  assert.equal(formatDuration(40, "en"), "0m");
  assert.equal(formatDuration(-10, "en"), "0m");
});

test("formatDuration: the ListFormat fallback matches Intl.DurationFormat when present", () => {
  const seconds = 3 * DAY + 2 * HOUR + 14 * MINUTE;
  const fallback = formatDuration(seconds, "en", { preferDurationFormat: false });
  assert.equal(fallback, "3d 2h 14m");
  if (typeof Intl.DurationFormat === "function") {
    assert.equal(formatDuration(seconds, "en", { preferDurationFormat: true }), fallback);
  }
});

test("formatDuration: other locales get their own units, bad locales fall back to English", () => {
  const seconds = 2 * HOUR + 5 * MINUTE;
  assert.notEqual(formatDuration(seconds, "ja"), formatDuration(seconds, "en"));
  assert.notEqual(formatDuration(seconds, "ar", { preferDurationFormat: false }), formatDuration(seconds, "en"));
  assert.equal(formatDuration(seconds, "not a locale!!"), "2h 5m");
});

test("formatRelative: now / minutes / hours / days in the active locale", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  assert.equal(formatRelative("2026-11-21T12:00:00Z", { now, locale: "en" }), "now");
  assert.match(formatRelative("2026-11-21T11:55:00Z", { now, locale: "en" }), /5/);
  assert.match(formatRelative("2026-11-21T09:00:00Z", { now, locale: "en" }), /3/);
  assert.match(formatRelative("2026-11-18T12:00:00Z", { now, locale: "en" }), /3|ago/);
  assert.notEqual(
    formatRelative("2026-11-21T11:55:00Z", { now, locale: "ar" }),
    formatRelative("2026-11-21T11:55:00Z", { now, locale: "en" }));
  assert.equal(formatRelative("not a date", { now, locale: "en" }), "");
});

test("ban countdown keeps its contract through the new formatter", () => {
  const now = 1_000_000;
  assert.equal(formatBanCountdown(now + 3 * DAY + 2 * HOUR + 14 * MINUTE, now), "3d 2h 14m");
  assert.equal(formatBanCountdown(now - 5, now), "0m");
  assert.equal(formatBanCountdown(null, now), null);
});

test("callers use reltime: banned screen, profile ban line, chat widget stamps", () => {
  assert.match(read("public/js/banned.js"), /from "\.\/reltime\.js"/);
  assert.match(read("public/js/chat-widget.js"), /from "\.\/reltime\.js"/);
  assert.match(read("public/js/chat-widget.js"), /formatRelative\(/);
  const module = read("public/js/reltime.js");
  assert.match(module, /Intl\.RelativeTimeFormat/);
  assert.match(module, /Intl\.DurationFormat/);
  assert.match(module, /Intl\.ListFormat/);
  assert.doesNotMatch(module, /innerHTML|\bapi\(/);
});
