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

// Wave 2026-11-21-31 F1 hardening over v4.32-v4.35.
// 1. Upload count gate (MEDIUM): the 3-file cap must refuse a multipart body
//    BEFORE the 4th image part is read, sanitized, hashed and looked up —
//    a client-only cap is not a control, and a late server cap lets one
//    request drive hundreds of D1 lookups inside the byte ceiling.
// 2. Edit-cancel confirm (LOW): textareas normalize CR/CRLF to LF, so a body
//    stored with CRLF (API/MCP clients; the server only trims) must not read
//    as "unsaved changes" when nothing was typed.
// 3. Feed rollup: extra differential cases (deleted roots, roots hidden after
//    replies, ban flips) and the D1 100-bound-parameter ceiling at max page.
// 4. 0059: the dm pair lookup still plans on the UNIQUE(user_a, user_b) index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { MAX_ATTACHMENT_FILES, readComposedBody } from "../api/attachments.mjs";
import { banFilterSql, replyCountsBinds, replyCountsSql } from "../api/posts-feed.mjs";
import { viewerBlockFilterSql } from "../api/core/blocks.mjs";
import { createEditComposer, editHasUnsavedChanges } from "../public/js/render.js";

const D1_MAX_BOUND_PARAMS = 100;
const FEED_MAX_PAGE = 20;

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

function countingEnv() {
  const env = makeEnv();
  const real = env.FORUM_DB;
  const seen = { hashLookups: 0 };
  const db = Object.create(real);
  db.prepare = (sql) => {
    if (/FROM revoked_attachment_hashes WHERE hash = \?/.test(sql)) seen.hashLookups += 1;
    return real.prepare(sql);
  };
  return { env: { ...env, FORUM_DB: db }, seen };
}

function multipartRequest(imageCount, gifCount = 0, gifsFirst = false) {
  const form = new FormData();
  form.append("body", "hello");
  const gifs = () => { for (let i = 0; i < gifCount; i += 1) form.append("gifIds", "00000000-0000-0000-0000-00000000000" + i); };
  if (gifsFirst) gifs();
  for (let i = 0; i < imageCount; i += 1) {
    form.append("images", new File([PNG], "x" + i + ".png", { type: "image/png" }));
  }
  if (!gifsFirst) gifs();
  return new Request("https://wempos-forum.com/api/posts", { method: "POST", body: form });
}

test("upload: a body over the image cap is refused before the extra parts are processed", async () => {
  const { env, seen } = countingEnv();
  await assert.rejects(readComposedBody(multipartRequest(40), env), (error) => error.status === 400);
  assert.ok(seen.hashLookups <= MAX_ATTACHMENT_FILES,
    "hash lookups ran for " + seen.hashLookups + " parts past the cap of " + MAX_ATTACHMENT_FILES);
});

test("upload: gifIds before images count toward the cap early too", async () => {
  const { env, seen } = countingEnv();
  await assert.rejects(readComposedBody(multipartRequest(10, 3, true), env), (error) => error.status === 400);
  assert.equal(seen.hashLookups, 0);
});

test("upload: exactly the cap still parses and sanitizes every image", async () => {
  const { env } = countingEnv();
  const { files } = await readComposedBody(multipartRequest(MAX_ATTACHMENT_FILES), env);
  assert.equal(files.length, MAX_ATTACHMENT_FILES);
  for (const file of files) assert.equal(file.mime, "image/png");
});

test("upload: a non-image disguised by name and type is refused by the server sniff", async () => {
  const { env } = countingEnv();
  const form = new FormData();
  form.append("body", "hello");
  form.append("images", new File([new TextEncoder().encode("MZ not an image")], "cat.png", { type: "image/png" }));
  const request = new Request("https://wempos-forum.com/api/posts", { method: "POST", body: form });
  await assert.rejects(readComposedBody(request, env), (error) => error.status === 400);
});

test("edit cancel: a CRLF body with no typing is not an unsaved change", () => {
  const document = makeFakeDocument();
  for (const body of ["line one\r\nline two", "old mac\rline", "mixed\r\n\nend"]) {
    const article = new FakeNode("article");
    article.postBody = body;
    const form = createEditComposer({ id: 7, body }, document);
    article.append(form);
    // What a real textarea reports after its value is set: CR/CRLF -> LF.
    const textarea = form.querySelector("textarea");
    textarea.value = body.replace(/\r\n?/g, "\n");
    assert.equal(editHasUnsavedChanges(article), false, JSON.stringify(body));
    textarea.value += " edited";
    assert.equal(editHasUnsavedChanges(article), true, JSON.stringify(body));
  }
});

// --- Feed rollup differential, extra cases.

function frozenOldSql(ids, viewer) {
  const placeholders = ids.map(() => "?").join(", ");
  return "SELECT COALESCE(l1.parent_id, r.parent_id) AS thread_root, COUNT(*) AS reply_count " +
    "FROM posts r JOIN posts l1 ON l1.id = r.parent_id " +
    "WHERE (l1.parent_id IS NULL OR l1.parent_id IN (" + placeholders + ")) " +
    "AND ((r.visibility = 'public' AND " + banFilterSql("r") + ") OR r.author_id = ?) " +
    "AND (l1.parent_id IS NULL OR (l1.visibility = 'public' AND " + banFilterSql("l1") + ") OR l1.author_id = ?) " +
    viewerBlockFilterSql(viewer, "r.author_id") + viewerBlockFilterSql(viewer, "l1.author_id") +
    "GROUP BY thread_root";
}
const blockBindsFor = (viewer) =>
  (viewerBlockFilterSql(viewer, "r.author_id") ? [Number(viewer.id), Number(viewer.id)] : []);
const pick = (rows, ids) => {
  const wanted = new Set(ids);
  return Object.fromEntries(rows.filter((row) => wanted.has(Number(row.thread_root)))
    .map((row) => [Number(row.thread_root), Number(row.reply_count)]));
};
const oldCounts = (db, ids, viewer) => {
  const b = blockBindsFor(viewer);
  return pick(db.prepare(frozenOldSql(ids, viewer)).all(...ids, -1, -1, ...b, ...b), ids);
};
const newCounts = (db, ids, viewer) =>
  pick(db.prepare(replyCountsSql(ids, false, viewer)).all(...replyCountsBinds(ids, false, blockBindsFor(viewer))), ids);

async function smallForest() {
  const env = makeEnv();
  const db = env.__sqlite;
  const users = [];
  for (let i = 0; i < 6; i += 1) users.push(await seedUser(db, { username: "w31u" + i }));
  const roots = [];
  for (let i = 0; i < 6; i += 1) roots.push(seedPost(db, { authorId: users[i % 6], body: "root " + i }));
  const l1 = [];
  for (let i = 0; i < 24; i += 1) l1.push(seedPost(db, { authorId: users[(i + 1) % 6], body: "l1 " + i, parentId: roots[i % 6] }));
  for (let i = 0; i < 24; i += 1) seedPost(db, { authorId: users[(i + 2) % 6], body: "l2 " + i, parentId: l1[i] });
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(users[0], users[1], now());
  const viewers = [null, { id: users[0], role: "member" }, { id: users[1], role: "member" }, { id: users[5], role: "admin" }];
  return { db, users, roots, l1, viewers };
}
const assertSame = (db, ids, viewers, label) => {
  for (const viewer of viewers) {
    assert.deepEqual(newCounts(db, ids, viewer), oldCounts(db, ids, viewer), label + " viewer " + (viewer?.id ?? "anon"));
  }
};

test("rollup differential: a deleted root drops its whole subtree in both forms", async () => {
  const { db, roots, viewers } = await smallForest();
  db.prepare("DELETE FROM posts WHERE id = ?").run(roots[2]);
  assertSame(db, roots, viewers, "deleted root");
  assert.equal(newCounts(db, roots, null)[roots[2]], undefined);
});

test("rollup differential: a root hidden after replies keeps identical counts", async () => {
  const { db, roots, viewers } = await smallForest();
  db.prepare("UPDATE posts SET visibility = 'hidden' WHERE id = ?").run(roots[1]);
  db.prepare("UPDATE posts SET visibility = 'hidden' WHERE id = (SELECT id FROM posts WHERE parent_id = ? LIMIT 1)").run(roots[3]);
  assertSame(db, roots, viewers, "hidden root/level-1");
});

test("rollup differential: ban on, expiry, revoke flips keep the forms in step", async () => {
  const { db, users, roots, viewers } = await smallForest();
  const before = newCounts(db, roots, null);
  seedBan(db, users[2]);
  assertSame(db, roots, viewers, "active ban");
  const banned = newCounts(db, roots, null);
  assert.ok(Object.values(banned).reduce((a, b) => a + b, 0) < Object.values(before).reduce((a, b) => a + b, 0));
  db.prepare("UPDATE bans SET expires_at = ? WHERE user_id = ?").run(now() - 1, users[2]);
  assertSame(db, roots, viewers, "expired ban");
  assert.deepEqual(newCounts(db, roots, null), before, "expired ban restores counts with no write");
  db.prepare("UPDATE bans SET expires_at = NULL, revoked_at = ? WHERE user_id = ?").run(now(), users[2]);
  assertSame(db, roots, viewers, "revoked ban");
});

test("rollup: a full feed page for a blocking member stays under D1's 100 bound params", async () => {
  const { db, users } = await smallForest();
  const viewer = { id: users[0], role: "member" };
  const ids = Array.from({ length: FEED_MAX_PAGE }, (_, i) => 100000 + i);
  const sql = replyCountsSql(ids, false, viewer);
  const binds = replyCountsBinds(ids, false, blockBindsFor(viewer));
  assert.equal((sql.match(/\?/g) || []).length, binds.length);
  assert.ok(binds.length <= D1_MAX_BOUND_PARAMS, "binds " + binds.length);
  db.prepare(sql).all(...binds);
});

test("0059: the dm pair lookup still plans on the UNIQUE(user_a, user_b) index", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  db.exec("ANALYZE");
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id, user_a, user_b FROM dm_threads WHERE user_a = ? AND user_b = ? ORDER BY id LIMIT 1")
    .all(1, 2).map((row) => row.detail).join(" | ");
  assert.match(plan, /SEARCH dm_threads USING (?:COVERING )?INDEX sqlite_autoindex_dm_threads_1 \(user_a=\? AND user_b=\?\)/, plan);
});
