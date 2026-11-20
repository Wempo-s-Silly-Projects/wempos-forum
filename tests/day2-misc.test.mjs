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

// Day-2 misc pins: the chat-widget-ui static-analysis style — cheap source
// pins that hold the reply-count plumbing (Task A already rode the feed
// decorators; these fail loudly on a silent revert) and the invisible-mode
// toggle's wiring (Task B: the account settings panel reads the member's
// stored presence.invisible straight from the heartbeat endpoint's own
// response — no localStorage guess — and flips it with a flagged POST).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const postsFeed = read("../api/posts-feed.mjs");
const render = read("../public/js/render.js");
const feed = read("../public/js/routes/feed.js");

test("every feed thread card carries replyCount from the batched decorator", () => {
  // The row shape: withReplyMetadata stamps camelCase replyCount on every
  // root the feed serializer touches, missing rows default 0.
  assert.ok(postsFeed.includes("replyCount: replyCounts.get(Number(post.id)) || 0"),
    "the decorator's row shape");
  assert.ok(postsFeed.includes("withReplyMetadata"), "the decorator call name");
  // The chip: the card renderer shows the count as a quiet numeric seat
  // (chat icon + the count) and stays silent at 0, per the plan v2.3 law.
  assert.ok(render.includes('"reply-count icon-inline"'), "the chip's class seat");
  assert.ok(render.includes('createIcon(document, "chat")'), "the chip's icon");
  assert.ok(render.includes("Number(post.replyCount) > 0"), "zero stays silent");
});

test("the account settings panel carries the invisible-mode toggle pair", () => {
  // The copy says what it does, plain words, on the account page.
  assert.ok(feed.includes("Invisible on the Who's Online roster"), "the toggle label");
  // State source: the FLAG-LESS heartbeat POST (who-online.js already sends
  // it) returns the stored invisible flag — the panel reads the member's
  // current choice straight from the server response, never localStorage.
  assert.ok(feed.includes('api("/api/presence", { method: "POST", body: {} })'),
    "the heartbeat read arm");
  // The flip: a flagged POST {invisible: boolean} per the chat.mjs contract;
  // the response's invisible marks the active button via aria-pressed.
  assert.ok(feed.includes('"POST"'), "the write arms ride POST");
  assert.ok(feed.includes("data.invisible"), "the response's flag drives the mark");
  assert.ok(feed.includes("presence-invisible-toggle"), "the button pair's class seat");
  // No markup anywhere — the panel's copy rides textContent only.
  assert.ok(!feed.includes("innerHTML"), "the CSP-clean render path");
});
