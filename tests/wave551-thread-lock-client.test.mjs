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

// v5.51.0 staff thread lock, client side: the thread page's "locked" note,
// the composer gate, reply controls stripped for members, the staff
// Lock/Unlock pair in the existing staff menu (render.js) and its desk
// actions. DOM-pure builders over fake-dom; textContent only; no storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import {
  canReplyToThread,
  createThreadLockNote,
  createThreadLockReason,
  stripReplyControls,
  threadLockPath,
} from "../public/js/thread-lock.js";
import { createPostCard } from "../public/js/render.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const STAFF = { id: 1, username: "boss", role: "owner" };
const ADMIN = { id: 2, username: "deputy", role: "admin" };
const MEMBER = { id: 3, username: "bob", role: null };

function rootPost(overrides = {}) {
  return {
    id: 12, body: "thread root", parent: null, visibility: "public", board: "general", createdAt: "2026-11-22T10:00:00.000Z",
    author: { id: 9, username: "alice", role: null, avatarUrl: null }, likeCount: 0, dislikeCount: 0, viewerReaction: null,
    replyCount: 0, subReplyCount: 0, pinnedAt: null, staffPick: false, slowModeSeconds: null, locked: false, ...overrides,
  };
}

test("lock path is id-only", () => {
  assert.equal(threadLockPath(12), "/api/admin/threads/12/lock");
  assert.equal(threadLockPath("34"), "/api/admin/threads/34/lock");
  for (const junk of ["1/../x", "abc", -1, 0, 1.5, "012"]) assert.throws(() => threadLockPath(junk), RangeError, String(junk));
});

test("locked note: one line for everyone, nothing when the thread is open", () => {
  assert.equal(createThreadLockNote(doc, false), null);
  assert.equal(createThreadLockNote(doc, undefined), null);
  const note = createThreadLockNote(doc, true);
  assert.equal(note.tagName.toLowerCase(), "p");
  assert.equal(note.className, "thread-lock-note");
  assert.equal(note.getAttribute("role"), "status");
  assert.equal(note.textContent, t("threadLock.note"));
});

test("staff reason line: textContent only (markup stays text), nothing when there is no reason", () => {
  assert.equal(createThreadLockReason(doc, null), null);
  assert.equal(createThreadLockReason(doc, ""), null);
  const hostile = "<img src=x onerror=alert(1)>";
  const line = createThreadLockReason(doc, hostile);
  assert.equal(line.className, "thread-lock-reason");
  assert.equal(line.textContent, t("threadLock.reason", { reason: hostile }));
  assert.equal(line.children.length, 0, "no parsed markup");
});

test("composer gate: members lose it on a locked thread, staff keep it; guests, hidden and replies never get one", () => {
  const open = rootPost();
  const locked = rootPost({ locked: true });
  assert.equal(canReplyToThread(open, MEMBER), true);
  assert.equal(canReplyToThread(locked, MEMBER), false);
  assert.equal(canReplyToThread(locked, STAFF), true);
  assert.equal(canReplyToThread(locked, ADMIN), true);
  assert.equal(canReplyToThread(open, null), false);
  assert.equal(canReplyToThread(rootPost({ visibility: "hidden" }), STAFF), false);
  assert.equal(canReplyToThread(rootPost({ parent: { id: 1, body: "" } }), STAFF), false);
});

test("stripReplyControls removes Reply and Quote buttons only, from a live collection safely", () => {
  const list = doc.createElement("div");
  for (const action of ["reply-to", "quote", "edit-post", "reply-to", "expand-sub-replies"]) {
    const button = doc.createElement("button");
    button.dataset.action = action;
    list.append(button);
  }
  assert.equal(stripReplyControls(list), 3);
  const left = [...list.querySelectorAll("button")].map((b) => b.dataset.action);
  assert.deepEqual(left, ["edit-post", "expand-sub-replies"]);
  assert.equal(stripReplyControls(list), 0);
});

test("staff menu: root cards offer Lock or Unlock by the payload; members and reply cards never see it", () => {
  const lockButton = (card) => [...card.querySelectorAll("button")].find((b) => /^thread-(un)?lock$/.test(b.dataset.action || ""));
  const open = lockButton(createPostCard(rootPost(), doc, STAFF));
  assert.equal(open.dataset.action, "thread-lock");
  assert.equal(open.dataset.postId, "12");
  assert.equal(open.textContent, t("threadLock.lock"));
  const locked = lockButton(createPostCard(rootPost({ locked: true }), doc, ADMIN));
  assert.equal(locked.dataset.action, "thread-unlock");
  assert.equal(locked.textContent, t("threadLock.unlock"));
  assert.equal(lockButton(createPostCard(rootPost({ locked: true }), doc, MEMBER)), undefined);
  assert.equal(lockButton(createPostCard(rootPost({ locked: true }), doc, null)), undefined);
  assert.equal(lockButton(createPostCard(rootPost({ parent: { id: 1, body: "x" } }), doc, STAFF)), undefined);
});

test("wiring: thread page gates the composer, strips reply controls, shows the note; desk actions PUT/DELETE", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /createThreadLockNote\(document, post\.locked\)/);
  assert.match(post, /canReplyToThread\(post, context\.session\.user\)/);
  assert.match(post, /stripReplyControls\(/);
  assert.match(post, /createThreadLockReason\(/);
  const admin = read("public/js/routes/admin.js");
  assert.ok(admin.includes("\"thread-lock\"") && admin.includes("\"thread-unlock\""));
  assert.match(admin, /threadLockPath\(button\.dataset\.postId\), \{ method: "PUT", body: \{ reason \} \}/);
  assert.match(admin, /threadLockPath\(button\.dataset\.postId\), \{ method: "DELETE" \}/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/thread-lock\.js">/);
});

test("new client module: no HTML sinks, no device storage, no fetch of its own", () => {
  const source = read("public/js/thread-lock.js");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|api\(/);
});
