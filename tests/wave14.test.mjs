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

// Wave 2026-11-21-14: community traditions — the QOTD chip and today's
// question on the home feed (with a "You answered" chip), and an image-first
// gallery on the showcase board. Both routes obey the visibility law: hidden,
// banned and block-paired content never shows.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { createQotdBanner, createShowcaseGallery, isQotdBody } from "../public/js/traditions.js";
import { findByClass, countByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

let env;
let db;
const u = {};
const s = {};

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const name of ["author", "reader", "staff", "other"]) {
    u[name] = await seedUser(db, { username: name, role: name === "staff" ? "admin" : "member" });
    s[name] = forgeSession(db, u[name]);
  }
});

beforeEach(() => {
  db.prepare("DELETE FROM blocks").run();
  db.prepare("DELETE FROM bans").run();
  db.prepare("DELETE FROM revoked_attachment_hashes").run();
  db.prepare("DELETE FROM attachments").run();
  db.prepare("DELETE FROM posts").run();
});

const block = (blocker, blocked) =>
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(u[blocker], u[blocked], now());
const ageBy = (postId, seconds) =>
  db.prepare("UPDATE posts SET created_at = created_at - ? WHERE id = ?").run(seconds, postId);
const qotd = async (who) => (await call(env, "/api/traditions/qotd", who ? { session: s[who] } : {})).json();
const gallery = async (who) => (await call(env, "/api/traditions/showcase", who ? { session: s[who] } : {})).json();

let attachmentSeq = 0;
const seedImage = (postId, { status = "approved", hash } = {}) => {
  attachmentSeq += 1;
  const id = "00000000-0000-4000-8000-" + String(attachmentSeq).padStart(12, "0");
  const imageHash = hash ?? "hash-" + attachmentSeq;
  db.prepare(
    "INSERT INTO attachments (id, post_id, created_by, created_at, mime, version, status, hash, source_kind) " +
    "VALUES (?, ?, (SELECT author_id FROM posts WHERE id = ?), ?, 'image/png', 'v1', ?, ?, 'upload')",
  ).run(id, postId, postId, now(), status, imageHash);
  const kind = status === "approved" ? "approved" : "pending";
  db.prepare("INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES (?, ?, 0, ?)")
    .run(id, kind, new Uint8Array([137, 80, 78, 71]));
  return id;
};

// --- F1: today's QOTD ----------------------------------------------------------

test("qotd: the newest visible root from the last day whose body starts with QOTD", async () => {
  const old = seedPost(db, { authorId: u.author, body: "QOTD: yesterday's question" });
  ageBy(old, 2 * 86400);
  seedPost(db, { authorId: u.author, body: "not a question of the day" });
  const first = seedPost(db, { authorId: u.author, body: "  qotd — favourite build?" });
  const root = seedPost(db, { authorId: u.other, body: "plain thread" });
  seedPost(db, { authorId: u.author, body: "QOTD in a reply is not a thread", parentId: root });
  const body = await qotd(null);
  assert.equal(body.qotd.id, first);
  assert.equal(body.qotd.answered, false);
  assert.deepEqual(Object.keys(body.qotd).sort(), ["answered", "board", "body", "createdAt", "id"]);
  assert.doesNotMatch(JSON.stringify(body), /password|salt|email|ip_/i);
});

test("qotd: none from the last day is null", async () => {
  const old = seedPost(db, { authorId: u.author, body: "QOTD stale" });
  ageBy(old, 2 * 86400);
  assert.equal((await qotd(null)).qotd, null);
});

test("qotd: a hidden QOTD never shows — not even to staff or its author", async () => {
  const visible = seedPost(db, { authorId: u.other, body: "QOTD visible" });
  seedPost(db, { authorId: u.author, body: "QOTD hidden", visibility: "hidden" });
  for (const who of [null, "reader", "staff", "author"]) {
    assert.equal((await qotd(who)).qotd.id, visible, String(who));
  }
});

test("qotd: an actively banned author's QOTD vanishes; an expired ban restores it", async () => {
  const id = seedPost(db, { authorId: u.author, body: "QOTD banned" });
  seedBan(db, u.author, null);
  assert.equal((await qotd(null)).qotd, null);
  assert.equal((await qotd("reader")).qotd, null);
  db.prepare("DELETE FROM bans").run();
  seedBan(db, u.author, -60);
  assert.equal((await qotd(null)).qotd.id, id);
});

test("qotd: a block pair hides the author's QOTD from the viewer both ways; guests still see it", async () => {
  const fallback = seedPost(db, { authorId: u.other, body: "QOTD older" });
  const blocked = seedPost(db, { authorId: u.author, body: "QOTD newer" });
  block("author", "reader");
  assert.equal((await qotd("reader")).qotd.id, fallback);
  db.prepare("DELETE FROM blocks").run();
  block("reader", "author");
  assert.equal((await qotd("reader")).qotd.id, fallback);
  assert.equal((await qotd(null)).qotd.id, blocked);
});

// --- F3: "You answered" ----------------------------------------------------------

test("qotd answered: true once the viewer replied (level 1 or 2), false for others and guests", async () => {
  const id = seedPost(db, { authorId: u.author, body: "QOTD answer me" });
  assert.equal((await qotd("reader")).qotd.answered, false);
  const reply = seedPost(db, { authorId: u.other, body: "my answer", parentId: id });
  assert.equal((await qotd("other")).qotd.answered, true);
  assert.equal((await qotd("reader")).qotd.answered, false);
  seedPost(db, { authorId: u.reader, body: "nested answer", parentId: reply });
  assert.equal((await qotd("reader")).qotd.answered, true);
  assert.equal((await qotd(null)).qotd.answered, false);
});

test("qotd answered: the viewer's own reply under another thread does not count", async () => {
  seedPost(db, { authorId: u.author, body: "QOTD today" });
  const elsewhere = seedPost(db, { authorId: u.other, body: "elsewhere" });
  seedPost(db, { authorId: u.reader, body: "reply", parentId: elsewhere });
  assert.equal((await qotd("reader")).qotd.answered, false);
});

// --- F2: showcase gallery ----------------------------------------------------------

test("gallery: showcase roots with an approved image, newest first, first image as the cover", async () => {
  const a = seedPost(db, { authorId: u.author, body: "my drawing", board: "showcase" });
  const coverA = seedImage(a);
  seedImage(a);
  const b = seedPost(db, { authorId: u.other, body: "my build", board: "showcase" });
  const coverB = seedImage(b);
  seedPost(db, { authorId: u.author, body: "no image", board: "showcase" });
  const general = seedPost(db, { authorId: u.author, body: "wrong board", board: "general" });
  seedImage(general);
  const pending = seedPost(db, { authorId: u.author, body: "pending", board: "showcase" });
  seedImage(pending, { status: "pending" });
  const reply = seedPost(db, { authorId: u.author, body: "reply pic", parentId: a });
  seedImage(reply);
  const body = await gallery(null);
  assert.deepEqual(body.items.map((item) => item.id), [b, a]);
  assert.deepEqual(body.items[0].image, { id: coverB, version: "v1" });
  assert.equal(body.items[1].image.id, coverA);
  assert.equal(body.items[1].authorName, "author");
  assert.deepEqual(Object.keys(body.items[0]).sort(), ["authorName", "body", "createdAt", "id", "image"]);
  assert.doesNotMatch(JSON.stringify(body), /password|salt|email|ip_/i);
});

test("gallery: a revoked image hash drops the tile", async () => {
  const id = seedPost(db, { authorId: u.author, body: "revoked", board: "showcase" });
  seedImage(id, { hash: "bad-hash" });
  db.prepare("INSERT INTO revoked_attachment_hashes (hash, revoked_at) VALUES ('bad-hash', ?)").run(now());
  assert.deepEqual((await gallery(null)).items, []);
});

test("gallery: hidden roots never show — not to guests, members, staff or the author", async () => {
  const visible = seedPost(db, { authorId: u.author, body: "shown", board: "showcase" });
  seedImage(visible);
  const hidden = seedPost(db, { authorId: u.author, body: "hidden", board: "showcase", visibility: "hidden" });
  seedImage(hidden);
  for (const who of [null, "reader", "staff", "author"]) {
    assert.deepEqual((await gallery(who)).items.map((item) => item.id), [visible], String(who));
  }
});

test("gallery: an actively banned author's tiles vanish; an expired ban restores them", async () => {
  const id = seedPost(db, { authorId: u.author, body: "art", board: "showcase" });
  seedImage(id);
  seedBan(db, u.author, null);
  assert.deepEqual((await gallery(null)).items, []);
  assert.deepEqual((await gallery("reader")).items, []);
  db.prepare("DELETE FROM bans").run();
  seedBan(db, u.author, -60);
  assert.equal((await gallery(null)).items.length, 1);
});

test("gallery: a block pair hides tiles both ways; guests and others still see them", async () => {
  const id = seedPost(db, { authorId: u.author, body: "art", board: "showcase" });
  seedImage(id);
  block("author", "reader");
  assert.deepEqual((await gallery("reader")).items, []);
  db.prepare("DELETE FROM blocks").run();
  block("reader", "author");
  assert.deepEqual((await gallery("reader")).items, []);
  assert.equal((await gallery("other")).items.length, 1);
  assert.equal((await gallery(null)).items.length, 1);
});

test("gallery: at most 24 tiles", async () => {
  for (let i = 0; i < 26; i += 1) seedImage(seedPost(db, { authorId: u.author, body: "art " + i, board: "showcase" }));
  assert.equal((await gallery(null)).items.length, 24);
});

test("traditions routes: GET only", async () => {
  for (const path of ["/api/traditions/qotd", "/api/traditions/showcase"]) {
    const response = await call(env, path, { method: "POST", session: s.reader, body: {} });
    assert.notEqual(response.status, 200, path);
  }
});

// --- Client ------------------------------------------------------------------------

test("isQotdBody: QOTD at the start (any case, leading whitespace), nothing else", () => {
  assert.equal(isQotdBody("QOTD: best game?"), true);
  assert.equal(isQotdBody("  \n qotd what's up"), true);
  assert.equal(isQotdBody("my QOTD answer"), false);
  assert.equal(isQotdBody(""), false);
  assert.equal(isQotdBody(null), false);
});

test("qotd banner: links to the thread, masks spoilers, chips 'You answered' only when answered", () => {
  const banner = createQotdBanner(fakeDocument, { id: 7, body: "QOTD ||secret|| pick one", answered: false });
  const link = findByClass(banner, "qotd-link");
  assert.equal(link.href ?? link.attributes.href, "/posts/7");
  assert.equal(link.attributes["data-app-link"], "");
  assert.doesNotMatch(link.textContent, /secret/);
  assert.equal(countByClass(banner, "qotd-answered"), 0);
  const answered = createQotdBanner(fakeDocument, { id: 7, body: "QOTD x", answered: true });
  assert.equal(countByClass(answered, "qotd-answered"), 1);
});

test("showcase gallery: one tile per item with a lazy versioned image; empty state otherwise", () => {
  const grid = createShowcaseGallery(fakeDocument, [
    { id: 3, body: "a drawing", authorName: "amy", createdAt: "2026-01-01T00:00:00.000Z", image: { id: "abc", version: "v 1" } },
  ]);
  assert.equal(countByClass(grid, "gallery-tile"), 1);
  const tile = findByClass(grid, "gallery-tile");
  assert.equal(tile.href ?? tile.attributes.href, "/posts/3");
  const image = findByClass(grid, "gallery-image");
  assert.equal(image.src, "/api/attachments/abc?v=v%201");
  assert.equal(image.loading, "lazy");
  assert.ok(image.alt, "every tile image has alt text");
  assert.equal(findByClass(grid, "gallery-caption").textContent, "a drawing");
  const empty = createShowcaseGallery(fakeDocument, []);
  assert.equal(countByClass(empty, "gallery-tile"), 0);
  assert.ok(findByClass(empty, "empty-state"));
});

test("wiring: QOTD chip on cards, banner on home, gallery on the showcase board", () => {
  const render = read("public/js/render.js");
  assert.match(render, /isQotdBody\(post\.body\)/);
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /\/api\/traditions\/qotd/);
  assert.match(feed, /\/api\/traditions\/showcase/);
  assert.match(feed, /board\.slug === "showcase"/);
  const worker = read("worker.mjs");
  assert.match(worker, /handleTraditionRoutes/);
});

// --- Strings ---------------------------------------------------------------------

test("strings: the new tradition keys exist in every locale, translated, placeholders intact", () => {
  const keys = ["traditions.qotdTitle", "traditions.qotdToday", "traditions.qotdAnswered",
    "traditions.galleryTitle", "traditions.galleryEmpty", "traditions.galleryLoadFailed", "traditions.galleryAlt"];
  const en = JSON.parse(read("public/locales/en.json"));
  const files = readdirSync(new URL("../public/locales/", import.meta.url)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 41);
  for (const file of files) {
    const bundle = JSON.parse(read("public/locales/" + file));
    for (const key of keys) {
      assert.equal(typeof bundle[key], "string", file + " " + key);
      if (file !== "en.json") assert.notEqual(bundle[key], en[key], file + " " + key + " left in English");
    }
    assert.match(bundle["traditions.galleryAlt"], /\{title\}/, file);
  }
});
