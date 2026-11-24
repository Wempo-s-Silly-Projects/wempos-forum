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

// v5.96.0 Part B (SEO audit 2026-11-24): short-body description fallback,
// board page titles from the display label, sitemap lastmod + no member
// profiles, and the new home description. B1 (thread text in the served
// HTML) lives in wave40-cross-route-visibility.test.mjs with the gate sweep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { BOARD_HEADS, BOARD_VALUES } from "../api/boards.mjs";

const SHELL = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const EN = JSON.parse(readFileSync(new URL("../public/locales/en.json", import.meta.url), "utf8"));
const HOME_DESCRIPTION = "A friendly forum for the Polytoria community and friends. Post topics, chat with members and meet new people.";
const shellEnv = () => makeEnv({ ASSETS: makeAssets(() => new Response(SHELL, { headers: { "Content-Type": "text/html" } })) });
const decode = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const headOf = (html) => html.slice(0, html.indexOf("</head>"));
const titleOf = (html) => decode(headOf(html).match(/<title>([^<]*)<\/title>/)[1]);
const descriptionOf = (html) => decode(headOf(html).match(/<meta name="description" content="([^"]*)">/)[1]);
const BOARD_KEYS = { general: "general", "game-dev": "gameDev", showcase: "showcase", help: "help",
  suggestions: "suggestions", updates: "updates", polls: "polls" };

test("B2: a short body falls back to '<title> — a discussion in <board> on <site>'", async () => {
  const env = shellEnv();
  const author = await seedUser(env.__sqlite, { username: "shorty" });
  const tiny = seedPost(env.__sqlite, { authorId: author, body: "Need help", board: "help" });
  const html = await (await call(env, "/posts/" + tiny)).text();
  assert.equal(descriptionOf(html), `Need help — a discussion in ${BOARD_HEADS.help.label} on Wempo's Forum`);
  const long = seedPost(env.__sqlite, { authorId: author, body: "A long enough title\nwith plenty of words in the body to describe it well" });
  assert.ok(descriptionOf(await (await call(env, "/posts/" + long)).text()).startsWith("A long enough title with plenty"));
});

test("B3: board pages use the display label and the board's description", async () => {
  const html = await (await call(shellEnv(), "/c/general")).text();
  assert.equal(titleOf(html), "General — Wempo's Forum");
  assert.equal(descriptionOf(html), EN["boards.generalBlurb"]);
});

test("B3: the server's board heads match en.json labels and blurbs for every board", () => {
  assert.deepEqual(Object.keys(BOARD_HEADS).sort(), [...BOARD_VALUES].sort());
  for (const slug of BOARD_VALUES) {
    assert.equal(BOARD_HEADS[slug].label, EN[`boards.${BOARD_KEYS[slug]}Label`], slug);
    assert.equal(BOARD_HEADS[slug].blurb, EN[`boards.${BOARD_KEYS[slug]}Blurb`], slug);
  }
});

test("B4: the sitemap dates home and boards by public activity and lists no member profiles", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "Alice" });
  const banned = await seedUser(db, { username: "Banned" });
  const old = seedPost(db, { authorId: alice, body: "general root", board: "general" });
  db.prepare("UPDATE posts SET created_at = 1700000000 WHERE id = ?").run(old);
  const showcase = seedPost(db, { authorId: alice, body: "showcase root", board: "showcase" });
  db.prepare("UPDATE posts SET created_at = 1700000500 WHERE id = ?").run(showcase);
  // Newer, but not public: must not move any date.
  const hidden = seedPost(db, { authorId: alice, body: "hidden", board: "general", visibility: "hidden" });
  const bannedPost = seedPost(db, { authorId: banned, body: "banned", board: "general" });
  db.prepare("UPDATE posts SET created_at = 1800000000 WHERE id IN (?, ?)").run(hidden, bannedPost);
  seedBan(db, banned);
  const xml = await (await call(env, "/sitemap.xml")).text();
  const entry = (loc) => xml.match(new RegExp("<url><loc>" + loc.replace(/[.?]/g, "\\$&") + "</loc>(?:<lastmod>([^<]+)</lastmod>)?</url>"));
  assert.equal(entry("https://wempos-forum.com/")?.[1], new Date(1700000500 * 1000).toISOString());
  assert.equal(entry("https://wempos-forum.com/c/general")?.[1], new Date(1700000000 * 1000).toISOString());
  assert.equal(entry("https://wempos-forum.com/c/showcase")?.[1], new Date(1700000500 * 1000).toISOString());
  assert.ok(entry("https://wempos-forum.com/c/help"), "an empty board is still listed");
  assert.equal(entry("https://wempos-forum.com/c/help")[1], undefined, "no date without public activity");
  assert.doesNotMatch(xml, /\/users\//, "no member profile URLs");
  const profile = await call(env, "/api/users/Alice");
  assert.equal(profile.status, 200, "profiles stay reachable");
});

test("B5: the home meta description is the new copy, in the shell and as the server default", async () => {
  assert.match(SHELL, new RegExp(`<meta name="description" content="${HOME_DESCRIPTION.replace(/[.]/g, "\\.")}">`));
  const html = await (await call(shellEnv(), "/")).text();
  assert.equal(descriptionOf(html), HOME_DESCRIPTION);
  const bare = makeEnv({ ASSETS: makeAssets(() => new Response("<!doctype html><html><head><title>t</title></head><body></body></html>",
    { headers: { "Content-Type": "text/html" } })) });
  assert.equal(descriptionOf(await (await call(bare, "/")).text()), HOME_DESCRIPTION);
});
