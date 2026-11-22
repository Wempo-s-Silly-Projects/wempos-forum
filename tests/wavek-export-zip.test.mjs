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

// Batch K item 3: "Download my data" becomes a ZIP built in the browser with
// the vendored client-zip — the JSON export split into readable files plus
// the member's OWN uploaded images (post attachments they uploaded, their
// avatar). The server lists only the caller's uploads (created_by = caller,
// marketplace GIF picks excluded); the client fetches only paths it builds
// from that list, through the limiter, and skips any image that 404s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { EXPORT_SECTION_CAPS } from "../constants.mjs";
import { API_BATCH_CONCURRENCY } from "../public/js/request-retry.js";
import { EXPORT_FILE_NAME, downloadMyData, exportImagePlan, exportJsonFiles } from "../public/js/data-export.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_GIF = "33333333-3333-4333-8333-333333333333";

// Minimal ZIP reader: walks the central directory (client-zip stores files
// uncompressed) and returns { name: Uint8Array }.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let size = view.getUint32(offset + 20, true);
    let local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    // ZIP64 extra field (0x0001) carries the real sizes/offset when needed.
    let extra = offset + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (view.getUint32(offset + 24, true) === 0xffffffff) field += 8;
        if (size === 0xffffffff) { size = Number(view.getBigUint64(field, true)); field += 8; }
        if (local === 0xffffffff) local = Number(view.getBigUint64(field, true));
      }
      extra += 4 + length;
    }
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files[name] = bytes.subarray(dataStart, dataStart + size);
    offset += 45 + nameLength + extraLength + commentLength;
  }
  return files;
}

// --- server: the uploads section ---------------------------------------------------

async function seedUploads() {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const bob = await seedUser(db, { username: "bob" });
  const alicePost = seedPost(db, { authorId: alice, body: "alice with picture" });
  const bobPost = seedPost(db, { authorId: bob, body: "bob with picture" });
  const insert = db.prepare(
    "INSERT INTO attachments (id, post_id, created_by, created_at, mime, version, status, source_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run(UUID_A, alicePost, alice, now(), "image/png", "v1", "approved", "upload");
  insert.run(UUID_GIF, alicePost, alice, now(), "image/gif", "v1", "approved", "gif");
  insert.run(UUID_B, bobPost, bob, now(), "image/jpeg", "v1", "approved", "upload");
  return { env, db, alice, bob, alicePost };
}

test("the export lists the caller's own uploads only (no GIF picks, never another member's)", async () => {
  const { env, db, alice, alicePost } = await seedUploads();
  const res = await call(env, "/api/me/export", { session: forgeSession(db, alice) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.uploads.map((upload) => upload.id), [UUID_A]);
  assert.equal(data.uploads[0].postId, alicePost);
  assert.equal(data.uploads[0].mime, "image/png");
  assert.equal(data.truncated.uploads, false);
  assert.ok(Number.isSafeInteger(EXPORT_SECTION_CAPS.uploads) && EXPORT_SECTION_CAPS.uploads > 0);
});

// --- client: plan and files --------------------------------------------------------

test("exportImagePlan builds same-origin paths from well-formed ids only, plus the member's avatar", () => {
  const plan = exportImagePlan({
    profile: { id: 7, avatarStatus: "approved" },
    uploads: [
      { id: UUID_A, mime: "image/png" },
      { id: "../../api/admin", mime: "image/png" },
      { id: UUID_B, mime: "text/html" },
      { id: 42 },
    ],
  });
  assert.deepEqual(plan, [
    { path: `/api/attachments/${UUID_A}`, name: `images/uploads/${UUID_A}.png` },
    { path: `/api/attachments/${UUID_B}`, name: `images/uploads/${UUID_B}.img` },
    { path: "/api/avatars/7", name: "images/avatar" },
  ]);
  assert.deepEqual(exportImagePlan({ profile: { id: 7, avatarStatus: null }, uploads: [] }), []);
  assert.deepEqual(exportImagePlan({ profile: { id: "7; DROP", avatarStatus: "approved" } }), []);
  assert.deepEqual(exportImagePlan(null), []);
});

test("exportJsonFiles splits threads, replies, messages and profile out of the full export", () => {
  const data = {
    profile: { id: 7, username: "alice" },
    settings: { theme: "dark" },
    posts: [{ id: 1, parentId: null, body: "root" }, { id: 2, parentId: 1, body: "reply" }],
    directMessages: [{ id: 5, body: "dm" }],
  };
  const files = Object.fromEntries(exportJsonFiles(data).map((file) => [file.name, JSON.parse(file.input)]));
  assert.deepEqual(Object.keys(files).sort(),
    ["data.json", "direct-messages.json", "posts.json", "profile.json", "replies.json"]);
  assert.deepEqual(files["posts.json"].map((post) => post.id), [1]);
  assert.deepEqual(files["replies.json"].map((post) => post.id), [2]);
  assert.deepEqual(files["profile.json"], { profile: data.profile, settings: data.settings });
  assert.deepEqual(files["data.json"], data);
});

test("downloadMyData saves a ZIP holding the JSON and the member's own images, skipping 404s", async () => {
  const requested = [];
  const clicked = [];
  let active = 0;
  let peak = 0;
  const exportData = {
    profile: { id: 7, username: "alice", avatarStatus: "approved" },
    posts: [{ id: 1, parentId: null, body: "root" }],
    directMessages: [],
    uploads: Array.from({ length: 6 }, (_, index) => ({ id: `0000000${index}-0000-4000-8000-000000000000`, mime: "image/png" }))
      .concat({ id: UUID_B, mime: "image/jpeg" }),
  };
  const api = async (path, options = {}) => {
    requested.push(path);
    if (path === "/api/me/export") return exportData;
    assert.equal(options.as, "blob");
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    if (path.endsWith(UUID_B)) throw Object.assign(new Error("Attachment not found."), { status: 404 });
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  };
  let saved = null;
  const doc = makeFakeDocument({ body: new FakeNode("body") });
  const realCreate = doc.createElement;
  doc.createElement = (tag) => {
    const node = realCreate(tag);
    if (tag === "a") node.click = () => clicked.push({ href: node.href, download: node.download });
    return node;
  };
  const urls = { createObjectURL: (blob) => { saved = blob; return "blob:zip"; }, revokeObjectURL: () => {} };
  const result = await downloadMyData({ api, doc, urls, schedule: (fn) => fn() });

  assert.equal(EXPORT_FILE_NAME, "wempos-forum-data.zip");
  assert.deepEqual(clicked, [{ href: "blob:zip", download: EXPORT_FILE_NAME }]);
  assert.equal(result.missingImages, 1);
  assert.ok(peak <= API_BATCH_CONCURRENCY, `peak ${peak}`);
  const expected = ["/api/me/export", ...exportData.uploads.map((upload) => `/api/attachments/${upload.id}`), "/api/avatars/7"];
  assert.deepEqual([...requested].sort(), [...expected].sort(), "nothing outside the member's own list is fetched");

  const files = readZip(new Uint8Array(await saved.arrayBuffer()));
  const names = Object.keys(files).sort();
  assert.ok(names.includes("data.json") && names.includes("posts.json") && names.includes("direct-messages.json"));
  assert.ok(names.includes("images/avatar.png"), names.join(", "));
  assert.equal(names.filter((name) => name.startsWith("images/uploads/")).length, 6);
  assert.ok(!names.some((name) => name.includes(UUID_B)), "a 404 image is left out, not faked");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files["data.json"])), exportData);
  assert.deepEqual([...files["images/avatar.png"]], [137, 80, 78, 71]);
});

test("the ZIP is built on the vendored client-zip and the feed action reports missing images", () => {
  assert.match(read("public/js/data-export.js"), /from "\.\/vendor\/client-zip\.js"/);
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /data\.imagesMissing/);
});
