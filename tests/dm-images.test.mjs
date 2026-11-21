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

// v4.7 images in DMs (wave 2026-11-21-2): intake reuses the attachment
// pipeline (10 MiB cap, magic-byte sniff, sanitize, revoked-hash refusal)
// and serving is members-only — outsiders, removed members, block pairs
// with the uploader, banned uploaders and revoked hashes all get one 404.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../worker.mjs";
import { MAX_ATTACHMENT_BYTES } from "../api/attachments.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";

let env;
let db;
const u = {};
const s = {};
let threadId;
let groupId;

// The smallest PNG the intake sanitizer accepts: signature, IHDR, IDAT, IEND.
const pngChunk = (type, data) => {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const PNG = concat(
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
  pngChunk("IDAT", Uint8Array.from([0])),
  pngChunk("IEND", new Uint8Array(0)),
);

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const name of ["alice", "bob", "carol", "dave"]) {
    u[name] = await seedUser(db, { username: name });
    s[name] = forgeSession(db, u[name]);
  }
  threadId = Number(db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)")
    .run(Math.min(u.alice, u.bob), Math.max(u.alice, u.bob), now()).lastInsertRowid);
  groupId = Number(db.prepare("INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, '', ?)")
    .run(u.alice, now()).lastInsertRowid);
  for (const who of ["alice", "bob", "carol"]) {
    db.prepare("INSERT INTO dm_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)").run(groupId, u[who], now());
  }
});

beforeEach(() => {
  db.prepare("DELETE FROM blocks").run();
  db.prepare("DELETE FROM bans").run();
  db.prepare("DELETE FROM revoked_attachment_hashes").run();
});

const upload = (who, path, bytes = PNG, type = "image/png") => {
  const form = new FormData();
  form.append("image", new Blob([bytes], { type }), "pic.png");
  const headers = new Headers({ Origin: ORIGIN });
  if (who) {
    headers.set("Cookie", s[who].cookie);
    headers.set("X-CSRF-Token", s[who].csrf);
  }
  return worker.fetch(new Request(ORIGIN + path, { method: "POST", headers, body: form }), env, { waitUntil() {} });
};
const fetchImage = (who, id) => call(env, "/api/dm/images/" + id, who ? { session: s[who] } : {});
const uploadOk = async (who, path) => {
  const response = await upload(who, path);
  assert.equal(response.status, 201, await response.clone().text());
  const { message } = await response.json();
  const match = message.body.match(/^\[img:([0-9a-f-]{36})\]$/);
  assert.ok(match, "the stored message body is the image token");
  return match[1];
};

test("1:1 upload by a participant stores the image and its message; both participants fetch it", async () => {
  const id = await uploadOk("alice", "/api/dm/threads/" + threadId + "/images");
  for (const who of ["alice", "bob"]) {
    const response = await fetchImage(who, id);
    assert.equal(response.status, 200, who);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.match(response.headers.get("Cache-Control"), /^private/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);
  }
  const thread = await (await call(env, "/api/dm/threads/" + threadId, { session: s.bob })).json();
  assert.equal(thread.messages[0].body, "[img:" + id + "]");
  assert.ok(thread.unread >= 1, "an image send bumps the other side's unread");
});

test("outsiders, guests, and unknown ids cannot fetch a DM image (IDOR)", async () => {
  const id = await uploadOk("alice", "/api/dm/threads/" + threadId + "/images");
  assert.equal((await fetchImage("carol", id)).status, 404);
  assert.equal((await fetchImage(null, id)).status, 401);
  assert.equal((await fetchImage("alice", "00000000-0000-4000-8000-000000000000")).status, 404);
});

test("upload refusals: outsider, guest, non-image bytes, oversize, revoked hash", async () => {
  const path = "/api/dm/threads/" + threadId + "/images";
  assert.equal((await upload("carol", path)).status, 403);
  assert.equal((await upload(null, path)).status, 401);
  assert.equal((await upload("alice", path, new TextEncoder().encode("<script>alert(1)</script>!!"), "image/png")).status, 400);
  const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
  huge.set(PNG.subarray(0, 8));
  assert.equal((await upload("alice", path, huge)).status, 413);
  const hash = createHash("sha256").update(PNG).digest("hex");
  db.prepare("INSERT INTO revoked_attachment_hashes (hash, revoked_at) VALUES (?, ?)").run(hash, now());
  assert.equal((await upload("alice", path)).status, 400);
});

test("a block pair refuses the 1:1 upload and hides the image from the blocked side", async () => {
  const id = await uploadOk("alice", "/api/dm/threads/" + threadId + "/images");
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(u.bob, u.alice, now());
  assert.equal((await upload("alice", "/api/dm/threads/" + threadId + "/images")).status, 403);
  assert.equal((await fetchImage("bob", id)).status, 404);
  assert.equal((await fetchImage("alice", id)).status, 200, "the uploader still sees their own image");
});

test("group images: members fetch, outsiders and removed members get 404", async () => {
  const id = await uploadOk("bob", "/api/dm/groups/" + groupId + "/images");
  assert.equal((await fetchImage("carol", id)).status, 200);
  assert.equal((await fetchImage("dave", id)).status, 404);
  assert.equal((await upload("dave", "/api/dm/groups/" + groupId + "/images")).status, 404);
  db.prepare("DELETE FROM dm_group_members WHERE group_id = ? AND user_id = ?").run(groupId, u.carol);
  assert.equal((await fetchImage("carol", id)).status, 404);
  db.prepare("INSERT INTO dm_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)").run(groupId, u.carol, now());
});

test("a banned uploader's image and a revoked hash both stop serving", async () => {
  const id = await uploadOk("bob", "/api/dm/groups/" + groupId + "/images");
  seedBan(db, u.bob, null);
  assert.equal((await fetchImage("alice", id)).status, 404);
  db.prepare("DELETE FROM bans").run();
  assert.equal((await fetchImage("alice", id)).status, 200);
  const hash = createHash("sha256").update(PNG).digest("hex");
  db.prepare("INSERT INTO revoked_attachment_hashes (hash, revoked_at) VALUES (?, ?)").run(hash, now());
  assert.equal((await fetchImage("alice", id)).status, 404);
});
