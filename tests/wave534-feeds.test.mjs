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

// v5.34 — RSS 2.0 feeds (/feed.xml, /c/<board>/feed.xml) and /llms.txt.
// Feeds carry exactly the anonymous feed's visibility (public roots by an
// author with no active ban), page by FEED_PAGE_SIZE, mask spoilers in the
// description, and XML-escape every member-supplied byte. llms.txt is static
// branding-driven text: no post text and no member data.
import test from "node:test";
import assert from "node:assert/strict";
import { FEED_PAGE_SIZE } from "../constants.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";

const RSS_TYPE = /^application\/rss\+xml; charset=utf-8$/;

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const banned = await seedUser(db, { username: "zzbanned" });
  const expired = await seedUser(db, { username: "zzexpired" });
  const publicRoot = seedPost(db, { authorId: alice, body: "FEEDOKTXT first line\nmore text here" });
  seedPost(db, { authorId: alice, body: "SHOWCASEOKTXT shiny", board: "showcase" });
  const hidden = seedPost(db, { authorId: alice, body: "HIDDENROOTTXT", visibility: "hidden" });
  seedPost(db, { authorId: alice, body: "UNDERHIDDENTXT", parentId: hidden });
  seedPost(db, { authorId: alice, body: "REPLYTXT not a topic", parentId: publicRoot });
  seedPost(db, { authorId: banned, body: "BANNEDTXT root" });
  seedPost(db, { authorId: expired, body: "EXPIREDOKTXT root" });
  seedBan(db, banned);
  seedBan(db, expired, -3600);
  return { env, db, alice, publicRoot };
}

const items = (xml) => xml.match(/<item>/g) || [];

test("/feed.xml is RSS 2.0 of public topics with the right type, cache and ETag", async () => {
  const w = await world();
  const res = await call(w.env, "/feed.xml");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), RSS_TYPE);
  assert.match(res.headers.get("Cache-Control"), /max-age=\d+/);
  const etag = res.headers.get("ETag");
  assert.match(etag, /^W\/"[0-9a-f]{16,}"$/);
  const xml = await res.text();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0"/);
  assert.match(xml, /<atom:link href="https:\/\/wempos-forum\.com\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.ok(xml.includes("<link>https://wempos-forum.com/posts/" + w.publicRoot + "</link>"));
  assert.ok(xml.includes('<guid isPermaLink="true">https://wempos-forum.com/posts/' + w.publicRoot + "</guid>"));
  assert.ok(xml.includes("<title>FEEDOKTXT first line</title>"));
  assert.match(xml, /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
  for (const ok of ["FEEDOKTXT", "SHOWCASEOKTXT", "EXPIREDOKTXT"]) assert.ok(xml.includes(ok), ok);
  for (const bad of ["HIDDENROOTTXT", "UNDERHIDDENTXT", "BANNEDTXT", "REPLYTXT", "zzbanned"]) assert.ok(!xml.includes(bad), bad);
  const again = await call(w.env, "/feed.xml", { headers: { "If-None-Match": etag } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
});

test("/c/<board>/feed.xml lists only that board; an unknown board is a 404", async () => {
  const w = await world();
  const showcase = await (await call(w.env, "/c/showcase/feed.xml")).text();
  assert.ok(showcase.includes("SHOWCASEOKTXT"));
  assert.ok(!showcase.includes("FEEDOKTXT"));
  assert.ok(showcase.includes("<link>https://wempos-forum.com/c/showcase</link>"));
  const missing = await call(w.env, "/c/nope/feed.xml");
  assert.equal(missing.status, 404);
  assert.equal((await call(w.env, "/c/constructor/feed.xml")).status, 404);
});

test("feeds page by FEED_PAGE_SIZE and never take a caller limit", async () => {
  const env = makeEnv();
  const author = await seedUser(env.__sqlite, { username: "bulk" });
  for (let i = 0; i < FEED_PAGE_SIZE + 7; i++) seedPost(env.__sqlite, { authorId: author, body: "bulk " + i });
  for (const path of ["/feed.xml", "/feed.xml?limit=500", "/c/general/feed.xml"]) {
    assert.equal(items(await (await call(env, path)).text()).length, FEED_PAGE_SIZE, path);
  }
});

test("XML breakout: member text cannot close an element, inject markup or end CDATA", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const evil = await seedUser(db, { username: "evil" });
  seedPost(db, { authorId: evil, body: "</title><script>alert(1)</script>]]>&amp;<![CDATA[x\"'\nline </description><item>" });
  const xml = await (await call(env, "/feed.xml")).text();
  assert.ok(!xml.includes("<script>"), "raw script tag");
  assert.ok(!xml.includes("]]>"), "CDATA terminator");
  assert.ok(!xml.includes("<![CDATA["), "CDATA opener");
  assert.equal(items(xml).length, 1, "a forged <item> opened");
  assert.equal((xml.match(/<\/title>/g) || []).length, 2, "channel + one item title only");
  assert.ok(xml.includes("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;]]&gt;&amp;amp;"));
  // Characters XML 1.0 cannot carry are dropped, never emitted.
  seedPost(db, { authorId: evil, body: "ctrl\u0001\u0008\u000Bchars\uFFFE here" });
  const withControls = await (await call(env, "/feed.xml")).text();
  assert.ok(withControls.includes("ctrlchars here"));
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(withControls), "XML-forbidden character");
  // Every & in the document starts a known entity (escape-html writes the
  // apostrophe as the numeric &#39;, L3).
  assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#39);)/.test(xml), "bare ampersand");
});

test("feed descriptions mask spoilers before the cut", async () => {
  const env = makeEnv();
  const author = await seedUser(env.__sqlite, { username: "spoil" });
  seedPost(env.__sqlite, { authorId: author, body: "Plot talk\nthe twist is ||SECRETENDING|| wow" });
  const xml = await (await call(env, "/feed.xml")).text();
  assert.ok(xml.includes("Plot talk"));
  assert.ok(!xml.includes("SECRETENDING"));
});

test("pages advertise the feeds with rel=alternate; the catalog and robots list feed + llms.txt", async () => {
  const env = makeEnv();
  const home = await (await call(env, "/", { headers: { Accept: "text/html" } })).text();
  assert.match(home, /<link rel="alternate" type="application\/rss\+xml" title="[^"]+" href="https:\/\/wempos-forum\.com\/feed\.xml">/);
  const board = await (await call(env, "/c/showcase", { headers: { Accept: "text/html" } })).text();
  assert.ok(board.includes('href="https://wempos-forum.com/c/showcase/feed.xml"'));
  const catalog = JSON.stringify(await (await call(env, "/.well-known/api-catalog")).json());
  assert.ok(catalog.includes("https://wempos-forum.com/feed.xml"));
  assert.ok(catalog.includes("https://wempos-forum.com/llms.txt"));
  const robots = await (await call(env, "/robots.txt")).text();
  assert.match(robots, /^# .*https:\/\/wempos-forum\.com\/llms\.txt/m);
  assert.match(robots, /^# .*https:\/\/wempos-forum\.com\/feed\.xml/m);
});

test("/llms.txt: plain text, the instance's own branding, the key links, and no post or member text", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "zzmemberalice" });
  seedPost(db, { authorId: alice, body: "LLMSFIXTURETXT a public post body" });
  db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('site_name', 'Gadget Garage', ?), " +
    "('site_tagline', 'Tinker talk for everyone', ?)").run(now(), now());
  const res = await call(env, "/llms.txt");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
  const text = await res.text();
  assert.match(text, /^# Gadget Garage\n/);
  assert.ok(text.includes("Tinker talk for everyone"));
  for (const link of ["/openapi.json", "/mcp", "/auth.md", "/sitemap.xml", "/feed.xml", "/c/showcase"]) {
    assert.ok(text.includes("https://wempos-forum.com" + link), link);
  }
  assert.match(text, /github\.com|SOURCE|source/i);
  assert.match(text, /privacy/i);
  assert.ok(!text.includes("LLMSFIXTURETXT"), "post body leaked");
  assert.ok(!text.includes("zzmemberalice"), "member name leaked");
  assert.equal((await call(env, "/llms.txt", { method: "HEAD" })).status, 200);
});
