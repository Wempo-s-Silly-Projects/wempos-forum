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

// Profile Chat-button pins (day-2 widget wave): the chat-widget-ui static-
// analysis style — cheap source pins that read routes/profile.js and the
// widget module and fail loudly on a silent revert. The load-bearing wiring:
// the button renders ONLY for a signed-in viewer of another member's
// profile, the action prefers the payload's numeric id for open-or-return,
// and the widget's own boot-probe law stays untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const profile = read("../public/js/routes/profile.js");
const widget = read("../public/js/chat-widget.js");

test("the Chat button mounts only for a signed-in viewer of another member's profile", () => {
  assert.ok(profile.includes('const chatButton = element("button", "button button-quiet", "Chat");'), "the button markup");
  assert.ok(profile.includes('chatButton.dataset.action = "chat-user";'), "the dispatch key");
  assert.ok(profile.includes('chatButton.dataset.profileId = String(profile.id);'), "the numeric seat");
  assert.ok(profile.includes('chatButton.dataset.username = profile.username;'), "the fallback username seat");
  // It must live inside the OTHER-member block: signed-out renders and the
  // owner's own profile never reach the button (the boot-probe law).
  const blockIndex = profile.indexOf("if (session.user && session.user.id !== profile.id) {");
  const chatIndex = profile.indexOf('chatButton.dataset.action = "chat-user";');
  assert.ok(blockIndex !== -1 && chatIndex > blockIndex, "the button rides the signed-in other-member block");
});

test("the chat-user action posts the profile's numeric id to open-or-return", () => {
  assert.ok(profile.includes('"chat-user":'), "the dispatch entry");
  assert.ok(
    profile.includes("body = Number.isInteger(profileId) && profileId > 0 ? { userId: profileId } : { username };"),
    "the userId preference over the username",
  );
  assert.ok(profile.includes('api("/api/dm/threads", { method: "POST", body })'), "the open-or-return POST");
  assert.ok(profile.includes("const threadId = thread?.id;"), "the returned thread id is read");
  assert.ok(profile.includes('throw new Error("The chat could not be started.")'), "an id-less echo refuses");
  assert.ok(profile.includes("await openChatThread(threadId);"), "the widget door gets the thread id");
});

test("profile.js imports openChatThread from the widget module (the boot law holds there)", () => {
  assert.ok(profile.includes('import { openChatThread } from "../chat-widget.js";'), "the import");
  assert.ok(widget.includes("await boot();"), "the widget still self-mounts (signed-out visitors stay inert)");
});
