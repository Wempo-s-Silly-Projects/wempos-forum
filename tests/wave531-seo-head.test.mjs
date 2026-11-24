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

// v5.31.0 — SEO + share previews: per-page <title>, description, canonical,
// Open Graph + Twitter tags, JSON-LD data blocks and noindex, all rendered by
// the worker on the HTML shell under the visibility law.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";

const SITE = "https://forum.example";
const SHELL = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const shellAssets = () => makeAssets(() => new Response(SHELL, {
  status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
}));
const seoEnv = (overrides = {}) => makeEnv({ ASSETS: shellAssets(), SITE_ORIGIN: SITE, ...overrides });

const decode = (value) => value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const headOf = (html) => html.slice(0, html.indexOf("</head>"));
function metas(html, attr) {
  const found = {};
  for (const [tag] of headOf(html).matchAll(/<meta\b[^>]*>/g)) {
    const key = tag.match(new RegExp(`\\b${attr}="([^"]*)"`));
    const content = tag.match(/\bcontent="([^"]*)"/);
    if (key && content) (found[key[1]] ??= []).push(decode(content[1]));
  }
  return found;
}
function page(html) {
  const names = metas(html, "name");
  const props = metas(html, "property");
  const titles = [...headOf(html).matchAll(/<title>([^<]*)<\/title>/g)].map((m) => decode(m[1]));
  const canon = [...headOf(html).matchAll(/<link rel="canonical" href="([^"]*)">/g)].map((m) => decode(m[1]));
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  return { names, props, titles, canon, ld, html };
}
async function fetchPage(env, path, options) {
  const response = await call(env, path, options);
  return { response, ...page(await response.text()) };
}
const one = (list, label) => {
  assert.ok(Array.isArray(list) && list.length === 1, `exactly one ${label}, got ${JSON.stringify(list)}`);
  return list[0];
};

async function seedThread(env, body, extra = {}) {
  const authorId = await seedUser(env.__sqlite, { username: extra.username || "author1" });
  const postId = seedPost(env.__sqlite, {
    authorId, body, board: extra.board || "general", visibility: extra.visibility || "public",
  });
  return { authorId, postId };
}

const GENERIC_TITLE = "Wempo's Forum: Have fun and meet new people!";
const GENERIC_DESCRIPTION = decode(SHELL.match(/<meta name="description" content="([^"]*)">/)[1]);

// ---- per-route head --------------------------------------------------------

test("home: one branded title, one description, canonical = og:url, site-wide JSON-LD", async () => {
  const p = await fetchPage(seoEnv(), "/?utm=1");
  assert.equal(p.response.status, 200);
  assert.equal(one(p.titles, "title"), GENERIC_TITLE);
  assert.equal(one(p.names.description, "description"), GENERIC_DESCRIPTION);
  assert.equal(one(p.canon, "canonical"), SITE + "/");
  assert.equal(one(p.props["og:url"], "og:url"), SITE + "/");
  assert.equal(one(p.props["og:type"], "og:type"), "website");
  assert.equal(one(p.props["og:site_name"], "og:site_name"), "Wempo's Forum");
  assert.equal(one(p.props["og:title"], "og:title"), p.titles[0]);
  assert.equal(one(p.props["og:description"], "og:description"), p.names.description[0]);
  assert.equal(one(p.props["og:image"], "og:image"), SITE + "/og-image.png");
  assert.equal(one(p.names["twitter:card"], "twitter:card"), "summary_large_image");
  assert.equal(one(p.names["twitter:title"], "twitter:title"), p.titles[0]);
  assert.equal(one(p.names["twitter:description"], "twitter:description"), p.names.description[0]);
  assert.equal(one(p.names["twitter:image"], "twitter:image"), SITE + "/og-image.png");
  assert.equal(p.names.robots, undefined, "home is indexable");
  const types = p.ld.map((block) => block["@type"]).sort();
  assert.deepEqual(types, ["Organization", "WebSite"]);
  const site = p.ld.find((block) => block["@type"] === "WebSite");
  assert.equal(site.url, SITE + "/");
  assert.equal(site.name, "Wempo's Forum");
});

test("saved branding names the site in title, og:site_name and JSON-LD", async () => {
  const env = seoEnv();
  env.__sqlite.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('site_name', ?, 1), ('site_tagline', ?, 1)")
    .run("Cat Club", "Purr & chat");
  const p = await fetchPage(env, "/");
  assert.equal(p.titles[0], "Cat Club: Purr & chat");
  assert.equal(p.props["og:site_name"][0], "Cat Club");
  assert.equal(p.ld.find((block) => block["@type"] === "Organization").name, "Cat Club");
});

test("category: board title + description, canonical on /c/<board> (also for /suggestions)", async () => {
  const p = await fetchPage(seoEnv(), "/c/game-dev?view=new");
  // v5.96.0 B3: the board's display label and its own description.
  assert.equal(one(p.titles, "title"), "Game development — Wempo's Forum");
  assert.match(p.names.description[0], /^Devlogs, works in progress/);
  assert.equal(p.canon[0], SITE + "/c/game-dev");
  assert.equal(p.props["og:url"][0], p.canon[0]);
  const s = await fetchPage(seoEnv(), "/suggestions");
  assert.equal(s.canon[0], SITE + "/c/suggestions");
});

test("thread: title + masked excerpt of the root post, article type, DiscussionForumPosting", async () => {
  const env = seoEnv();
  const body = "My first thread\nHello there, this has a ||secret ending|| and lots of words. " + "x".repeat(300);
  const { postId } = await seedThread(env, body);
  const replier = await seedUser(env.__sqlite, { username: "replier" });
  seedPost(env.__sqlite, { authorId: replier, body: "a reply", parentId: postId });
  seedPost(env.__sqlite, { authorId: replier, body: "hidden reply", parentId: postId, visibility: "hidden" });
  const p = await fetchPage(env, `/posts/${postId}`);
  assert.equal(p.response.status, 200);
  assert.equal(one(p.titles, "title"), "My first thread — Wempo's Forum");
  const description = one(p.names.description, "description");
  assert.ok(description.startsWith("My first thread Hello there"), description);
  assert.ok(!description.includes("secret ending"), "spoiler masked before the cut");
  assert.ok(description.length <= 151, `excerpt capped (${description.length})`);
  assert.equal(p.canon[0], `${SITE}/posts/${postId}`);
  assert.equal(p.props["og:url"][0], p.canon[0]);
  assert.equal(p.props["og:type"][0], "article");
  assert.equal(p.props["og:description"][0], description);
  const posting = p.ld.find((block) => block["@type"] === "DiscussionForumPosting");
  assert.ok(posting, "DiscussionForumPosting block present");
  assert.equal(posting.url, `${SITE}/posts/${postId}`);
  assert.equal(posting.headline, "My first thread");
  assert.equal(posting.text, description);
  assert.equal(posting.author.name, "author1");
  assert.equal(posting.author.url, `${SITE}/users/author1`);
  assert.match(posting.datePublished, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(posting.interactionStatistic.interactionType, "https://schema.org/CommentAction");
  assert.equal(posting.interactionStatistic.userInteractionCount, 1, "hidden reply not counted");
  assert.ok(!JSON.stringify(p.ld).includes("hidden reply"));
});

test("profile: username in title only when the profile is public", async () => {
  const env = seoEnv();
  await seedUser(env.__sqlite, { username: "Kitty" });
  const p = await fetchPage(env, "/users/kitty");
  assert.equal(one(p.titles, "title"), "Kitty — Wempo's Forum");
  assert.match(p.names.description[0], /Kitty/);
  assert.equal(p.canon[0], SITE + "/users/Kitty");
  assert.equal(p.props["og:type"][0], "profile");
  assert.equal(p.props["og:url"][0], p.canon[0]);
});

test("unknown route: 404 status, noindex, generic not-found title, no canonical", async () => {
  const p = await fetchPage(seoEnv(), "/no/such/page");
  assert.equal(p.response.status, 404);
  assert.equal(one(p.names.robots, "robots"), "noindex");
  assert.equal(one(p.titles, "title"), "Not found — Wempo's Forum");
  assert.equal(p.canon.length, 0);
  assert.equal(p.props["og:url"], undefined);
});

// ---- visibility law --------------------------------------------------------

const LEAK = "TOPSECRETLEAKWORD";

async function assertGenericThread(env, postId, options) {
  const p = await fetchPage(env, `/posts/${postId}`, options);
  assert.equal(p.response.status, 200, "known route keeps its 200");
  assert.ok(!p.html.includes(LEAK), "no content leaks anywhere in the document");
  assert.ok(!p.html.includes("author1"), "no author name leaks");
  assert.equal(one(p.titles, "title"), GENERIC_TITLE);
  assert.equal(one(p.names.description, "description"), GENERIC_DESCRIPTION);
  assert.equal(one(p.names.robots, "robots"), "noindex");
  assert.equal(p.props["og:type"][0], "website");
  assert.ok(!p.ld.some((block) => block["@type"] === "DiscussionForumPosting"));
  return p;
}

test("hidden thread → generic head, no excerpt, noindex", async () => {
  const env = seoEnv();
  const { postId } = await seedThread(env, `Hidden ${LEAK}`, { visibility: "hidden" });
  await assertGenericThread(env, postId);
});

test("actively banned author → generic head; expired ban → visible again", async () => {
  const env = seoEnv();
  const { authorId, postId } = await seedThread(env, `Banned ${LEAK}`);
  seedBan(env.__sqlite, authorId);
  await assertGenericThread(env, postId);
  env.__sqlite.prepare("UPDATE bans SET expires_at = ? WHERE user_id = ?").run(now() - 10, authorId);
  const p = await fetchPage(env, `/posts/${postId}`);
  assert.ok(p.titles[0].includes(LEAK), "an expired ban restores the head with no write");
});

test("public reply under a hidden root → generic head", async () => {
  const env = seoEnv();
  const { authorId, postId } = await seedThread(env, "root", { visibility: "hidden" });
  const replyId = seedPost(env.__sqlite, { authorId, body: `reply ${LEAK}`, parentId: postId });
  await assertGenericThread(env, replyId);
});

test("deleted / missing thread → the same generic head (no existence oracle)", async () => {
  const env = seoEnv();
  const missing = await fetchPage(env, "/posts/999999");
  const { postId } = await seedThread(env, `x ${LEAK}`, { visibility: "hidden" });
  const hidden = await fetchPage(env, `/posts/${postId}`);
  const strip = (html) => headOf(html).replace(/\/posts\/\d+/g, "/posts/N");
  assert.equal(strip(missing.html), strip(hidden.html));
});

test("block pair (either direction) → generic head for that signed-in viewer", async () => {
  const env = seoEnv();
  const { authorId, postId } = await seedThread(env, `Blocked ${LEAK}`);
  const viewerId = await seedUser(env.__sqlite, { username: "viewer" });
  const session = forgeSession(env.__sqlite, viewerId);
  env.__sqlite.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(viewerId, authorId, now());
  await assertGenericThread(env, postId, { session });
  env.__sqlite.prepare("DELETE FROM blocks").run();
  env.__sqlite.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(authorId, viewerId, now());
  await assertGenericThread(env, postId, { session });
});

test("staff viewer still gets the public face: a hidden thread stays generic", async () => {
  const env = seoEnv();
  const { postId } = await seedThread(env, `Hidden ${LEAK}`, { visibility: "hidden" });
  const adminId = await seedUser(env.__sqlite, { username: "boss", role: "admin" });
  await assertGenericThread(env, postId, { session: forgeSession(env.__sqlite, adminId) });
});

test("banned, blocked or missing profile → generic head, noindex", async () => {
  const env = seoEnv();
  const userId = await seedUser(env.__sqlite, { username: "Shady" + LEAK });
  seedBan(env.__sqlite, userId);
  for (const path of [`/users/shady${LEAK.toLowerCase()}`, "/users/nobody-here"]) {
    const p = await fetchPage(env, path);
    assert.ok(!headOf(p.html).toLowerCase().includes(LEAK.toLowerCase()), path);
    assert.equal(p.titles[0], GENERIC_TITLE);
    assert.equal(p.names.robots[0], "noindex");
  }
  const other = await seedUser(env.__sqlite, { username: "Visible" + LEAK });
  const viewerId = await seedUser(env.__sqlite, { username: "viewer" });
  env.__sqlite.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(other, viewerId, now());
  const p = await fetchPage(env, `/users/visible${LEAK.toLowerCase()}`, { session: forgeSession(env.__sqlite, viewerId) });
  assert.ok(!p.titles[0].includes(LEAK), "blocked viewer gets the generic title");
  assert.equal(p.names.robots[0], "noindex");
});

// ---- escaping --------------------------------------------------------------

test("attribute values are escaped: quotes, <, > and & never open markup", async () => {
  const env = seoEnv();
  const nasty = `"><img src=x onerror=alert(1)> Tom & Jerry's <b>"quote"</b>`;
  const { postId } = await seedThread(env, nasty);
  const p = await fetchPage(env, `/posts/${postId}`);
  const head = headOf(p.html);
  assert.ok(!head.includes("<img"), "no injected tag in the head");
  assert.ok(!head.includes("<b>"), "no injected tag in the head");
  assert.ok(head.includes("&quot;&gt;&lt;img"), "attribute-escaped form present");
  assert.ok(head.includes("Tom &amp; Jerry"), "ampersand escaped");
  // v5.96.0 B2: a body that is only its title gets the fallback sentence.
  assert.equal(p.names.description[0], nasty + " — a discussion in General on Wempo's Forum");
  assert.equal(p.titles[0], nasty + " — Wempo's Forum");
});

test("JSON-LD breakout: a post containing </script> cannot close the data block", async () => {
  const env = seoEnv();
  const body = "Title </script><script>alert(1)</script> <!-- & more";
  const { postId } = await seedThread(env, body);
  const response = await call(env, `/posts/${postId}`);
  const html = await response.text();
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 3, "WebSite + Organization + DiscussionForumPosting");
  for (const block of blocks) {
    assert.ok(!block.includes("<"), "no raw < inside a JSON-LD block");
    JSON.parse(block);
  }
  assert.ok(!html.includes("<script>alert(1)"), "no executable script injected");
  const posting = blocks.map((b) => JSON.parse(b)).find((b) => b["@type"] === "DiscussionForumPosting");
  assert.ok(posting.text.includes("</script><script>alert(1)</script>"), "content survives the JSON round-trip");
  // Every inline (src-less) script in the served document is a JSON-LD data block.
  for (const [tag] of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/gi)) {
    assert.equal(tag, '<script type="application/ld+json">');
  }
});

// ---- share image + self-host overrides ------------------------------------

test("/og-image.png is a real 1200x630 PNG with an SVG source, both covered by REUSE.toml", () => {
  const png = readFileSync(new URL("../public/og-image.png", import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const svg = readFileSync(new URL("../public/og-image.svg", import.meta.url), "utf8");
  assert.match(svg, /<svg\b[^>]*width="1200"[^>]*height="630"/);
  const reuse = readFileSync(new URL("../REUSE.toml", import.meta.url), "utf8");
  assert.match(reuse, /"public\/og-image\.png"/);
  assert.match(reuse, /"public\/og-image\.svg"/);
});

test("/og-image.png passes through the worker as 200 image/png (no SPA re-judging)", async () => {
  const png = readFileSync(new URL("../public/og-image.png", import.meta.url));
  const assets = makeAssets((request) => (new URL(request.url).pathname === "/og-image.png"
    ? new Response(png, { status: 200, headers: { "Content-Type": "image/png" } })
    : new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html" } })));
  const response = await call(makeEnv({ ASSETS: assets }), "/og-image.png");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});

test("OG_IMAGE_URL override: an http(s) URL replaces og:image, anything else is ignored", async () => {
  const custom = "https://cdn.example.org/card.png?v=1&x=\"2\"";
  const p = await fetchPage(seoEnv({ OG_IMAGE_URL: custom }), "/");
  const expected = new URL(custom).href;
  assert.equal(p.props["og:image"][0], expected);
  assert.equal(p.names["twitter:image"][0], expected);
  assert.ok(!headOf(p.html).includes('x="2"'), "quote never lands raw in an attribute");
  for (const bad of ["javascript:alert(1)", "not a url", "  ", "data:image/png;base64,AAAA"]) {
    const q = await fetchPage(seoEnv({ OG_IMAGE_URL: bad }), "/");
    assert.equal(q.props["og:image"][0], SITE + "/og-image.png", bad);
  }
});

test("without SITE_ORIGIN the canonical uses the request origin", async () => {
  const p = await fetchPage(makeEnv({ ASSETS: shellAssets() }), "/c/help");
  assert.equal(p.canon[0], "https://wempos-forum.com/c/help");
  assert.equal(p.props["og:image"][0], "https://wempos-forum.com/og-image.png");
});

test("wrangler.example.toml documents OG_IMAGE_URL for self-hosters", () => {
  const toml = readFileSync(new URL("../wrangler.example.toml", import.meta.url), "utf8");
  assert.match(toml, /^OG_IMAGE_URL = ""$/m);
});

test("a database failure degrades to the generic head, never a broken page", async () => {
  const env = seoEnv();
  const { postId } = await seedThread(env, `x ${LEAK}`);
  const broken = { ...env, FORUM_DB: { prepare() { throw new Error("db down"); } } };
  const original = console.error;
  console.error = () => {};
  try {
    const p = await fetchPage(broken, `/posts/${postId}`);
    assert.equal(p.response.status, 200);
    assert.ok(!p.html.includes(LEAK));
    assert.equal(one(p.titles, "title"), GENERIC_TITLE);
  } finally {
    console.error = original;
  }
});

// ---- sitemap ---------------------------------------------------------------

test("sitemap: lastmod on thread entries, only publicly visible threads", async () => {
  const env = seoEnv();
  const { authorId, postId } = await seedThread(env, "visible");
  const hiddenId = seedPost(env.__sqlite, { authorId, body: "h", visibility: "hidden" });
  const bannedAuthor = await seedUser(env.__sqlite, { username: "banned" });
  const bannedPost = seedPost(env.__sqlite, { authorId: bannedAuthor, body: "b" });
  seedBan(env.__sqlite, bannedAuthor);
  const xml = await (await call(env, "/sitemap.xml")).text();
  assert.match(xml, new RegExp(`<url><loc>${SITE}/posts/${postId}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}T[^<]+</lastmod></url>`));
  assert.ok(!xml.includes(`/posts/${hiddenId}<`));
  assert.ok(!xml.includes(`/posts/${bannedPost}<`));
  assert.ok(!xml.includes("/users/banned<"));
});
