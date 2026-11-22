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

// v5.65.0: 17 more profile social networks (migration 0077). Members enter a
// HANDLE; the forum builds every URL from a fixed template, so a member-typed
// URL is never stored or rendered. Same visibility as the old socials (the
// block-pair refusal carries none), same export path, row removal clears them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { SOCIAL_PLATFORMS } from "../api/core/shapers.mjs";
import {
  buildSocialLinks,
  createPaymentNote,
  invalidSocialKeys,
  normalizeSocialHandle,
  PAYMENT_SOCIAL_KEYS,
  renderProfileSocials,
  SOCIAL_LABELS,
  SOCIAL_PATTERNS,
  SOCIAL_PLATFORM_ORDER,
} from "../public/js/profile-editor.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "migrations/0077_social_links_more.sql";

// key -> [valid handle, expected URL]
const NEW = {
  facebook: ["zuck.page", "https://www.facebook.com/zuck.page"],
  tumblr: ["staff-blog", "https://staff-blog.tumblr.com"],
  indiegogo: ["my-cool-gadget", "https://www.indiegogo.com/projects/my-cool-gadget"],
  shopify: ["my-shop", "https://my-shop.myshopify.com"],
  buymeacoffee: ["wempo_", "https://buymeacoffee.com/wempo_"],
  substack: ["wempo-news", "https://wempo-news.substack.com"],
  kickstarter: ["wempo_games", "https://www.kickstarter.com/profile/wempo_games"],
  cameo: ["some.star", "https://www.cameo.com/some.star"],
  paypal: ["WempoPay", "https://www.paypal.me/WempoPay"],
  kofi: ["wempo_k", "https://ko-fi.com/wempo_k"],
  patreon: ["wempo-art", "https://www.patreon.com/wempo-art"],
  cashapp: ["Wempo_1", "https://cash.app/$Wempo_1"],
  venmo: ["Wempo-V", "https://venmo.com/u/Wempo-V"],
  linktree: ["wempo.links", "https://linktr.ee/wempo.links"],
  beacons: ["wempo_b", "https://beacons.ai/wempo_b"],
  soundcloud: ["wempo-beats", "https://soundcloud.com/wempo-beats"],
  spotify: ["0TnOYISbd1XYRBk9myaseg", "https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg"],
};
const KEYS = Object.keys(NEW);

const INVALID = {
  facebook: ["abcd", "a".repeat(51), "has space", "under_score", "https://facebook.com/x"],
  tumblr: ["-edge", "edge-", "a".repeat(33), "dot.ted", "x.tumblr.com"],
  indiegogo: ["Upper", "a".repeat(81), "a/b", "slash/"],
  shopify: ["ab", "-shop", "shop-", "Shop", "shop.com", "a".repeat(61)],
  buymeacoffee: ["a-b", "a".repeat(51), "a.b"],
  substack: ["Upper", "-x", "x-", "a".repeat(64), "x.substack.com"],
  kickstarter: ["a".repeat(41), "a.b", "a/b"],
  cameo: [".", "..", "a".repeat(41), "a/b", "a b"],
  paypal: ["a_b", "a".repeat(21), "a.b", "paypal.me/x"],
  kofi: ["a-b", "a".repeat(41), "a.b"],
  patreon: ["a".repeat(65), "a.b", "a/b"],
  cashapp: ["1abc", "_abc", "a".repeat(21), "$$abc", "$abc", "a.b"],
  venmo: ["abcd", "a".repeat(31), "a.bcd"],
  linktree: [".", "..", "a".repeat(31), "a-b"],
  beacons: [".", "..", "a".repeat(31), "a-b"],
  soundcloud: ["ab", "Upper", "a".repeat(26), "a.b"],
  spotify: ["a".repeat(21), "a".repeat(23), "0TnOYISbd1XYRBk9myase_"],
};
const HOSTILE = [
  "https://evil.example/x", "javascript:alert(1)", "a b", " lead", "trail ", "a\nb", "a%2Fb",
  "<b>x</b>", "", "a\u0000b",
];

// ---- shared shape ---------------------------------------------------------

test("all 17 networks are server platforms mapped to social_<key> columns", () => {
  for (const key of KEYS) {
    const platform = SOCIAL_PLATFORMS.find((candidate) => candidate.key === key);
    assert.ok(platform, key);
    assert.equal(platform.column, "social_" + key);
  }
  assert.equal(SOCIAL_PLATFORMS.length, 27);
});

test("client patterns mirror the server regexes exactly; order and labels cover every key", () => {
  for (const platform of SOCIAL_PLATFORMS) {
    assert.equal(SOCIAL_PATTERNS[platform.key].source, platform.regex.source, platform.key);
    assert.equal(SOCIAL_PATTERNS[platform.key].flags, platform.regex.flags, platform.key);
    assert.ok(SOCIAL_PLATFORM_ORDER.includes(platform.key), platform.key);
    assert.equal(typeof SOCIAL_LABELS[platform.key], "string");
  }
  assert.equal(SOCIAL_PLATFORM_ORDER.length, 27);
  assert.equal(SOCIAL_PLATFORM_ORDER.at(-1), "polytoria");
  assert.equal(SOCIAL_LABELS.kofi, "Ko-fi");
});

test("each regex accepts its valid handle and rejects bad, URL and javascript: input", () => {
  for (const key of KEYS) {
    const regex = SOCIAL_PLATFORMS.find((candidate) => candidate.key === key).regex;
    assert.ok(regex.test(NEW[key][0]), key + " valid");
    for (const bad of [...INVALID[key], ...HOSTILE]) {
      assert.equal(regex.test(bad), false, key + " accepted " + JSON.stringify(bad));
    }
  }
});

test("cash app: exactly one leading $ is stripped on input, nothing else is", () => {
  assert.equal(normalizeSocialHandle("cashapp", "$Wempo_1"), "Wempo_1");
  assert.equal(normalizeSocialHandle("cashapp", "$$Wempo"), "$Wempo");
  assert.equal(normalizeSocialHandle("venmo", "$Wempo"), "$Wempo");
  assert.equal(normalizeSocialHandle("cashapp", null), null);
});

// ---- client links ---------------------------------------------------------

test("link building: fixed templates, encoded handles, never a member URL", () => {
  const socials = Object.fromEntries(KEYS.map((key) => [key, NEW[key][0]]));
  const links = buildSocialLinks(socials);
  assert.equal(links.length, 17);
  for (const link of links) {
    assert.equal(link.url, NEW[link.key][1], link.key);
    assert.equal(link.text, NEW[link.key][0]);
  }
  // A hostile value that somehow reached the payload never becomes a link:
  // the client re-checks the pattern and falls back to plain text.
  for (const key of KEYS) {
    for (const bad of ["x/../@evil.example?#", "a.evil.example/x?y#z", "javascript:alert(1)"]) {
      const [link] = buildSocialLinks({ [key]: bad });
      assert.equal(link.url, undefined, key + " " + bad);
      assert.equal(link.text, bad);
    }
  }
  // Every built href stays on its fixed https host with the handle encoded.
  for (const link of links) {
    const parsed = new URL(link.url);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.search + parsed.hash, "", link.key);
  }
});

test("invalidSocialKeys flags hostile handles for the new networks; empty clears", () => {
  for (const key of KEYS) {
    assert.deepEqual(invalidSocialKeys({ [key]: NEW[key][0] }), []);
    assert.deepEqual(invalidSocialKeys({ [key]: null }), []);
    assert.deepEqual(invalidSocialKeys({ [key]: "https://evil.example" }), [key]);
    assert.deepEqual(invalidSocialKeys({ [key]: "javascript:alert(1)" }), [key]);
  }
});

test("rendered social anchors carry rel=me nofollow noopener ugc", () => {
  const doc = makeFakeDocument();
  const node = renderProfileSocials(doc, { socials: { patreon: "wempo-art", github: "octo" } });
  const anchors = [];
  const walk = (n) => {
    if (String(n.tagName).toLowerCase() === "a") anchors.push(n);
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  assert.equal(anchors.length, 2);
  for (const anchor of anchors) assert.equal(anchor.rel, "me nofollow noopener ugc");
});

test("payment group: six adjacent keys and a translated muted note under them", () => {
  assert.deepEqual([...PAYMENT_SOCIAL_KEYS].sort(), ["buymeacoffee", "cashapp", "kofi", "patreon", "paypal", "venmo"]);
  const note = createPaymentNote(makeFakeDocument());
  assert.match(note.className, /\bmuted\b/);
  // No locale is loaded under node, so t() echoes the key; the en string is
  // pinned by the locale test below.
  assert.equal(note.textContent, "profileEditor.paymentNote");
  const indexes = PAYMENT_SOCIAL_KEYS.map((key) => SOCIAL_PLATFORM_ORDER.indexOf(key)).sort((a, b) => a - b);
  assert.equal(indexes.at(-1) - indexes[0], 5, "payment keys sit together");
  assert.match(read("public/js/profile-editor.js"), /createPaymentNote\(document\)/);
});

test("the payment note exists in every locale, translated outside English", () => {
  const files = readdirSync(new URL("../public/locales/", import.meta.url)).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 65);
  const en = JSON.parse(read("public/locales/en.json"))["profileEditor.paymentNote"];
  assert.equal(en, "Links open the service directly; the forum never handles payments.");
  for (const file of files) {
    const value = JSON.parse(read("public/locales/" + file))["profileEditor.paymentNote"];
    assert.equal(typeof value, "string", file);
    assert.ok(value.length > 10, file);
    if (file !== "en.json") assert.notEqual(value, en, file);
  }
});

// ---- migration ------------------------------------------------------------

test("migration 0077 only adds the 17 columns, each with the 120-char CHECK", () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(DROP|CREATE|INSERT|UPDATE|DELETE|REPLACE|RENAME)\b/i);
  const statements = sql.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  assert.equal(statements.length, 17);
  for (const key of KEYS) {
    const column = "social_" + key;
    assert.ok(statements.includes(
      `ALTER TABLE users ADD COLUMN ${column} TEXT CHECK (${column} IS NULL OR length(${column}) <= 120)`,
    ), column);
  }
  const env = makeEnv();
  const db = env.__sqlite;
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  for (const key of KEYS) assert.ok(cols.includes("social_" + key), key);
  db.prepare("INSERT INTO users (username, username_key, password_salt, password_hash, role, created_at) VALUES ('m','m','s','h','member',1)").run();
  assert.throws(() => db.prepare("UPDATE users SET social_venmo = ? WHERE username_key = 'm'").run("a".repeat(121)), /CHECK/);
  db.prepare("UPDATE users SET social_venmo = ? WHERE username_key = 'm'").run("a".repeat(120));
});

// ---- server ---------------------------------------------------------------

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "carol"]) id[name] = await seedUser(db, { username: name });
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}
const patch = (w, name, socials) =>
  call(w.env, "/api/me", { method: "PATCH", body: { socials }, session: w.session(name) });
const profile = async (w, name, viewer) => {
  const res = await call(w.env, "/api/users/" + name, viewer ? { session: w.session(viewer) } : undefined);
  assert.equal(res.status, 200);
  return res.json();
};
const ALL = () => ({ github: "octo", ...Object.fromEntries(KEYS.map((key) => [key, NEW[key][0]])) });
const newColumns = (w, name) =>
  w.db.prepare("SELECT " + KEYS.map((key) => "social_" + key).join(", ") + " FROM users WHERE id = ?").get(w.id[name]);

test("PATCH /api/me saves all 17, the profile returns them, null clears", async () => {
  const w = await world();
  const res = await patch(w, "alice", ALL());
  assert.equal(res.status, 200, await res.clone().text());
  const body = await profile(w, "alice");
  for (const key of KEYS) assert.equal(body.socials[key], NEW[key][0], key);
  const cleared = await patch(w, "alice", Object.fromEntries(KEYS.map((key) => [key, null])));
  assert.equal(cleared.status, 200);
  const after = await profile(w, "alice");
  for (const key of KEYS) assert.equal(after.socials[key], undefined, key);
  assert.equal(after.socials.github, "octo");
  for (const value of Object.values(newColumns(w, "alice"))) assert.equal(value, null);
});

test("PATCH rejects URLs, javascript:, whitespace for every new network; nothing is written", async () => {
  const w = await world();
  for (const key of KEYS) {
    for (const bad of ["https://evil.example/x", "javascript:alert(1)", "a b", "x\ty"]) {
      const res = await patch(w, "alice", { [key]: bad });
      assert.equal(res.status, 400, key + " " + bad);
    }
  }
  for (const value of Object.values(newColumns(w, "alice"))) assert.equal(value, null);
});

test("PATCH strips one leading $ from a cashtag; CSRF is still required", async () => {
  const w = await world();
  assert.equal((await patch(w, "alice", { cashapp: "$Wempo_1" })).status, 200);
  assert.equal(newColumns(w, "alice").social_cashapp, "Wempo_1");
  assert.equal((await patch(w, "alice", { cashapp: "$$Wempo" })).status, 400);
  const s = w.session("alice");
  const forged = await call(w.env, "/api/me", {
    method: "PATCH", body: { socials: { venmo: "Wempo-V" } }, session: { cookie: s.cookie, csrf: "wrong" },
  });
  assert.equal(forged.status, 403);
  assert.equal(newColumns(w, "alice").social_venmo, null);
});

test("visibility parity: new socials appear exactly where github does (anon, staff, banned, block both ways)", async () => {
  const w = await world();
  assert.equal((await patch(w, "alice", ALL())).status, 200);
  const block = w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)");
  block.run(w.id.alice, w.id.bob, now());
  block.run(w.id.carol, w.id.alice, now());
  const check = (body, label) => {
    const shown = body.socials.github === "octo";
    for (const key of KEYS) assert.equal(body.socials[key] === NEW[key][0], shown, label + " " + key);
    return shown;
  };
  assert.equal(check(await profile(w, "alice"), "anon"), true);
  assert.equal(check(await profile(w, "alice", "boss"), "staff"), true);
  assert.equal(check(await profile(w, "alice", "bob"), "blocked-by-author"), false);
  assert.equal(check(await profile(w, "alice", "carol"), "blocker-of-author"), false);
  seedBan(w.db, w.id.alice);
  const banned = await profile(w, "alice");
  assert.equal(banned.banned, true);
  check(banned, "banned-anon");
  check(await profile(w, "alice", "boss"), "banned-staff");
});

test("data export carries every new social; the users row going away takes them along", async () => {
  const w = await world();
  assert.equal((await patch(w, "alice", ALL())).status, 200);
  const res = await call(w.env, "/api/me/export", { session: w.session("alice") });
  assert.equal(res.status, 200);
  const data = await res.json();
  for (const key of KEYS) assert.equal(data.profile.socials[key], NEW[key][0], key);
  w.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(w.id.alice);
  w.db.prepare("DELETE FROM users WHERE id = ?").run(w.id.alice);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM users WHERE social_patreon IS NOT NULL").get().n, 0);
});
