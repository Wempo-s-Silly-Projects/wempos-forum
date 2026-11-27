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

// Wave 2026-11-21-17 F1: spoiler-path audit. Every place post/reply/wall text
// is shown OUTSIDE the full renderer is walked here with a body whose spoiler
// sits right on the 80-char cut, so a path that masks after cutting (or not
// at all) fails. A static sweep then fails any NEW excerpt line in api/ or
// public/js that cuts body-ish text without masking first.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { maskSpoilers, maskedExcerpt } from "../public/js/markdown.js";
import { maskSpoilers as serverMask, maskedExcerpt as serverExcerpt } from "../api/core/spoilers.mjs";
import { renderEditHistoryPanel } from "../public/js/render.js";
import { threadExcerpt } from "../public/js/profile-extras.js";
import { notificationPreview } from "../public/js/notifications.js";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const SECRET = /he di|dies/;
// 70 chars of lead-in put the opener inside the 80-char cut and the closer
// beyond it — the exact shape that leaked through v4.21 previews.
const SPLIT_BODY = "x".repeat(70) + " ||he dies at the end||";
const TITLE_BODY = "The twist: ||he dies||\n\nmore text";
const TOKEN = "wave17-agent-token-0123456789";

let env;
let session;
let rootId;
let titleRootId;
let replyId;

before(async () => {
  env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(TOKEN)]: "WemposClaude" }) });
  const db = env.__sqlite;
  const botId = await seedUser(db, { username: "WemposClaude" });
  const alice = await seedUser(db, { username: "Alice" });
  rootId = seedPost(db, { authorId: botId, body: "A plain topic" });
  titleRootId = seedPost(db, { authorId: alice, body: TITLE_BODY });
  replyId = seedPost(db, { authorId: alice, body: SPLIT_BODY, parentId: rootId });
  db.prepare("INSERT INTO notifications (user_id, target_post_id, reply_id, created_at) VALUES (?, ?, ?, ?)")
    .run(botId, rootId, replyId, now());
  db.prepare(
    "INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, " +
    "deleted_because, visibility) VALUES (?, ?, ?, ?, 'general', ?, ?, 'post-delete', 'public')",
  ).run(999, alice, "Alice", SPLIT_BODY, now(), now());
  session = forgeSession(db, botId);
});

async function mcpTool(name, args) {
  const response = await call(env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const json = await response.json();
  assert.ok(json.result, name + " answered: " + JSON.stringify(json));
  return json.result.content[0].text;
}

const markdown = async (path) =>
  (await call(env, path, { headers: { Accept: "text/markdown" } })).text();

// The audit list (server). Each entry returns what a reader of that path sees.
const SERVER_PATHS = {
  // Root bodies ride raw for the full renderer; the snippets are previews.
  "feed reply snippets (GET /api/posts)": async () => JSON.stringify(
    (await (await call(env, "/api/posts")).json()).posts.flatMap((post) => post.latestReplies)),
  "notification previews (GET /api/me/notifications)": async () =>
    (await call(env, "/api/me/notifications", { session })).text(),
  "public archive (GET /api/archive)": async () => (await call(env, "/api/archive")).text(),
  "MCP search_posts": () => mcpTool("search_posts", { query: "twist" }),
  "MCP recent_posts": () => mcpTool("recent_posts", {}),
  "MCP list_board": () => mcpTool("list_board", { board: "general" }),
  "MCP get_post (body + replies)": async () =>
    (await mcpTool("get_post", { id: rootId })) + (await mcpTool("get_post", { id: titleRootId })),
  "MCP list_mentions excerpt": () => mcpTool("list_mentions", {}),
  "markdown home feed": () => markdown("/"),
  "markdown board feed": () => markdown("/c/general"),
  "markdown post page (title, body, replies)": async () =>
    (await markdown("/posts/" + rootId)) + (await markdown("/posts/" + titleRootId)),
};

for (const [name, read] of Object.entries(SERVER_PATHS)) {
  test(`spoiler stays hidden: ${name}`, async () => {
    const out = await read();
    assert.ok(out.length > 0, name + " returned nothing");
    assert.doesNotMatch(out, SECRET, name + " leaked spoiler text:\n" + out.slice(0, 600));
  });
}

test("markdown and MCP still carry the non-spoiler words", async () => {
  assert.match(await markdown("/posts/" + titleRootId), /The twist: ▒▒▒/);
  assert.match(await mcpTool("get_post", { id: titleRootId }), /The twist: ▒▒▒/);
});

test("masking is output-only: the stored bodies are untouched", () => {
  const stored = env.__sqlite.prepare("SELECT body FROM posts WHERE id = ?").get(replyId).body;
  assert.equal(stored, SPLIT_BODY);
  const archived = env.__sqlite.prepare("SELECT body FROM post_archive WHERE original_post_id = 999").get().body;
  assert.equal(archived, SPLIT_BODY);
});

// ---- the one shared mask ---------------------------------------------------

test("server and client share ONE mask implementation", () => {
  assert.equal(serverMask, maskSpoilers);
  assert.equal(serverExcerpt, maskedExcerpt);
});

test("maskedExcerpt masks BEFORE it cuts", () => {
  assert.doesNotMatch(maskedExcerpt(SPLIT_BODY, 80), SECRET);
  assert.equal(maskedExcerpt("short ||x||", 80), "short ▒▒▒");
  assert.equal(maskedExcerpt("abcdef", 3), "abc…");
  assert.equal(maskedExcerpt(null, 10), "");
});

// ---- client paths ------------------------------------------------------------

const CLIENT_PATHS = {
  "profile/QOTD thread excerpt": () => threadExcerpt(SPLIT_BODY.repeat(2)),
  "notification preview (server-cut input)": () => notificationPreview(SPLIT_BODY.slice(0, 80)),
  "edit history panel": () => {
    const panel = renderEditHistoryPanel(makeFakeDocument(), [{ editedAt: new Date().toISOString(), body: SPLIT_BODY }]);
    return findByClass(panel, "edit-history-body").textContent;
  },
  // Wave 5.50: the word diff — the current version and every past one — runs
  // on the masked text, so neither side of a diff can surface a spoiler.
  "edit history word diff": () => {
    const panel = renderEditHistoryPanel(makeFakeDocument(), [
      { editedAt: new Date().toISOString(), body: SPLIT_BODY + " newer" },
      { editedAt: new Date().toISOString(), body: "older " + SPLIT_BODY },
    ], "current " + SPLIT_BODY);
    return panel.textContent;
  },
};

for (const [name, read] of Object.entries(CLIENT_PATHS)) {
  test(`spoiler stays hidden (client): ${name}`, () => {
    assert.doesNotMatch(read(), SECRET, name);
  });
}

test("client raw-text surfaces route through the shared mask", () => {
  assert.match(read("public/js/render.js"), /quoteSnippet = collapseWhitespace\(maskSpoilers\(post\.body\)\)/);
  assert.match(read("public/js/render.js"), /"edit-history-body", maskSpoilers\(/);
  assert.match(read("public/js/webmcp.js"), /excerpt: maskedExcerpt\(/);
  assert.match(read("public/js/render.js"), /preview-snippet", collapseWhitespace\(maskSpoilers\(reply\.snippet\)\)/);
  assert.match(read("public/js/routes/feed.js"), /maskSpoilers\(reply\.body\)/);
  assert.match(read("public/js/read-aloud.js"), /maskSpoilers\(body\)/);
});

// ---- static sweep: a NEW preview path without masking fails -------------------

// Lines that cut body-ish text but are NOT spoiler surfaces, with the reason.
const NOT_A_SPOILER_SURFACE = new Map([
  ["api/chat.mjs:LOBBY_CHAT_MAX_CHARS", "stored-length clamp on write (chat never renders spoilers)"],
  ["api/chat.mjs:DM_PREVIEW_MAX_CHARS", "DM thread-list preview (chat never renders spoilers)"],
  ["api/dm-groups.mjs:GROUP_PREVIEW_MAX_CHARS", "group DM preview (chat never renders spoilers)"],
  ["api/dm-groups.mjs:DM_MAX_BODY_CHARS", "stored-length clamp on write"],
  ["api/wall.mjs:WALL_MAX_CHARS", "stored-length clamp on write"],
  ["public/js/chat-widget-threads.js:MESSAGE_PREVIEW_MAX", "chat thread-list preview (chat never renders spoilers)"],
  ["public/js/mention-picker.js:caret", "composer caret arithmetic, not a preview"],
  ["public/js/mention-picker.js:start", "composer caret arithmetic, not a preview"],
  ["public/js/profile-extras.js:THREAD_EXCERPT_MAX", "masked one line above (maskSpoilers before the cut)"],
  ["public/js/quotes.js:limit", "input arrives pre-masked (render.js quoteSnippet)"],
  ["api/client-errors.mjs:2000", "client error report stack clamp (staff-only diagnostics, not a preview)"],
  ["api/client-errors.mjs:1200", "client error fingerprint input (hashed, never rendered)"],
  ["public/js/app.js:500", "client error report message clamp (staff-only diagnostics, not a preview)"],
]);

const EXCERPT_LINE = /\b(?:body|snippet|preview|excerpt|reply_body|message|text|firstLine|flat)\b[^\n;]*\.slice\(0,\s*([A-Z_0-9]+)/i;

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = dir + "/" + name;
    if (name === "vendor") return [];
    if (statSync(join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.m?js$/.test(name) ? [rel] : [];
  });
}

test("every body excerpt in api/ and public/js masks spoilers first (or is allow-listed)", () => {
  const offenders = [];
  for (const file of [...sourceFiles("api"), ...sourceFiles("public/js")]) {
    read(file).split("\n").forEach((line, i) => {
      const match = EXCERPT_LINE.exec(line);
      if (!match || /mask/i.test(line)) return;
      if (NOT_A_SPOILER_SURFACE.has(file + ":" + match[1])) return;
      offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], "unmasked excerpt paths:\n" + offenders.join("\n"));
});
