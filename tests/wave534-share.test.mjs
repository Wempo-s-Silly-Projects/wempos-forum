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

// v5.34 — share button (public/js/share.js) and the invite link client
// (public/js/invite.js). Share links are plain intent URLs carrying only the
// canonical thread URL and a spoiler-masked title; no SDK, no pixel, no
// network call of our own. The button never renders for a hidden post, a
// reply, or a staff viewer (staff can see content the public cannot). The
// Mastodon server and the pending invite ref are wiped on sign-out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MASTODON_STORAGE_KEY, canShare, clearAllShare, createShareButton, normalizeMastodonHost,
  shareTargets, shareTitle,
} from "../public/js/share.js";
import {
  INVITE_REF_KEY, claimPendingInvite, clearAllInvite, createInvitePanel, inviteLink,
  inviteRefFromSearch, rememberInviteRef,
} from "../public/js/invite.js";
import { routeForPath } from "../public/js/router.js";
import { makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const memoryStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    dump: () => Object.fromEntries(map),
  };
};
const ORIGIN = "https://wempos-forum.com";
const URL_OF = ORIGIN + "/posts/42";
const allLinks = (node) => [node, ...node.querySelectorAll("a")].filter((n) => n.tagName === "A");

test("intent URLs: fixed https hosts, every value percent-encoded, nothing but the URL and title", () => {
  const title = `Tom & "Jerry" <b>#1</b>? 100%`;
  const targets = shareTargets(URL_OF, title, "");
  assert.deepEqual(targets.map((t) => t.service), ["X", "Bluesky", "Reddit"]);
  for (const { href } of targets) {
    const url = new URL(href);
    assert.equal(url.protocol, "https:");
    assert.ok(!href.includes("<") && !href.includes('"') && !href.includes(" "), href);
    const values = [...url.searchParams.values()].join(" ");
    assert.ok(values.includes(URL_OF), href);
    assert.ok(values.includes(title), href);
  }
  assert.equal(new URL(targets[0].href).origin, "https://x.com");
  assert.equal(new URL(targets[1].href).origin, "https://bsky.app");
  assert.equal(new URL(targets[2].href).origin, "https://www.reddit.com");
  const withMasto = shareTargets(URL_OF, title, "mastodon.social");
  const masto = withMasto.at(-1);
  assert.equal(masto.service, "Mastodon");
  assert.equal(new URL(masto.href).origin, "https://mastodon.social");
  assert.equal(new URL(masto.href).pathname, "/share");
});

test("a Mastodon server is a bare host; schemes, paths, credentials and script are refused", () => {
  assert.equal(normalizeMastodonHost("mastodon.social"), "mastodon.social");
  assert.equal(normalizeMastodonHost("  https://Fosstodon.org/ "), "fosstodon.org");
  assert.equal(normalizeMastodonHost("social.example.co.uk:8443"), "social.example.co.uk:8443");
  for (const bad of ["javascript:alert(1)", "evil.com/path", "user@evil.com", "evil.com?x=1", "evil.com#x",
    "localhost", "-bad.com", "a..b", "<script>.com", "", "   ", "x".repeat(260) + ".com", null]) {
    assert.equal(normalizeMastodonHost(bad), "", String(bad));
  }
});

test("the share title masks spoilers before the cut and takes the first non-empty line", () => {
  assert.equal(shareTitle("\n  Hello there  \nsecond"), "Hello there");
  assert.ok(!shareTitle("The end ||SECRETENDING|| is wild").includes("SECRETENDING"));
  assert.ok(shareTitle("x".repeat(300)).length <= 101);
});

test("canShare: public root threads only, never for hidden posts, replies or staff viewers", () => {
  const root = { id: 42, body: "hi", visibility: "public", parent: null };
  assert.equal(canShare(root, null), true);
  assert.equal(canShare(root, { id: 1, role: null }), true);
  assert.equal(canShare({ ...root, visibility: "hidden" }, null), false);
  assert.equal(canShare({ ...root, parent: { id: 1 } }, null), false);
  assert.equal(canShare({ ...root, publicLevel: 1 }, null), false);
  assert.equal(canShare(root, { id: 1, role: "admin" }), false);
  assert.equal(canShare(root, { id: 1, role: "owner" }), false);
  assert.equal(canShare(null, null), false);
  const document = makeFakeDocument();
  assert.equal(createShareButton(document, { ...root, visibility: "hidden" }, null, { origin: ORIGIN }), null);
});

test("navigator.share is used when present, with the canonical URL and masked title only", async () => {
  const document = makeFakeDocument();
  const calls = [];
  const wrap = createShareButton(document, { id: 42, body: "Look ||SPOILERX|| here", visibility: "public", parent: null }, null, {
    origin: ORIGIN, navigator: { share: async (data) => { calls.push(data); } }, storage: memoryStorage(),
  });
  const button = findByClass(wrap, "share-button");
  await button.fire("click");
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["title", "url"]);
  assert.equal(calls[0].url, URL_OF);
  assert.ok(!calls[0].title.includes("SPOILERX"));
  assert.equal(findByClass(wrap, "share-menu").hidden, true, "the fallback menu stays closed");
});

test("without navigator.share the menu opens with copy + intent links that open safely", async () => {
  const document = makeFakeDocument();
  const storage = memoryStorage({ [MASTODON_STORAGE_KEY]: "mastodon.social" });
  const wrap = createShareButton(document, { id: 42, body: "A title", visibility: "public", parent: null }, null, {
    origin: ORIGIN, navigator: {}, storage,
  });
  const menu = findByClass(wrap, "share-menu");
  assert.equal(menu.hidden, true);
  await findByClass(wrap, "share-button").fire("click");
  assert.equal(menu.hidden, false);
  const links = allLinks(menu);
  assert.ok(links.length >= 4, "X, Bluesky, Reddit and the stored Mastodon server");
  for (const link of links) {
    assert.match(link.getAttribute("href"), /^https:\/\//);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  }
  assert.ok(findByClass(menu, "share-copy"), "copy link item");
  assert.ok(menu.querySelector("input"), "Mastodon server field");
});

test("saving a Mastodon server stores only a valid host, and the sign-out wipe removes it", async () => {
  const document = makeFakeDocument();
  const storage = memoryStorage({ other: "keep" });
  const wrap = createShareButton(document, { id: 42, body: "t", visibility: "public", parent: null }, null, {
    origin: ORIGIN, navigator: {}, storage,
  });
  const form = findByClass(wrap, "share-mastodon");
  const input = form.querySelector("input");
  input.value = "javascript:alert(1)";
  await form.fire("submit");
  assert.equal(storage.getItem(MASTODON_STORAGE_KEY), null);
  input.value = "https://hachyderm.io/";
  await form.fire("submit");
  assert.equal(storage.getItem(MASTODON_STORAGE_KEY), "hachyderm.io");
  clearAllShare(storage);
  assert.deepEqual(storage.dump(), { other: "keep" });
});

test("invite links and refs: encoded, username-shaped only", () => {
  assert.equal(inviteLink(ORIGIN, "alice_1"), ORIGIN + "/join?ref=alice_1");
  assert.equal(inviteRefFromSearch("?ref=Alice_1"), "Alice_1");
  for (const bad of ["?ref=a", "?ref=a%20b", "?ref=" + "x".repeat(30), "?ref=%3Cscript%3E", "", "?x=1"]) {
    assert.equal(inviteRefFromSearch(bad), "", bad);
  }
  assert.deepEqual(routeForPath("/join", "?ref=alice"), { name: "join", ref: "alice" });
  assert.deepEqual(routeForPath("/join", "?ref=<x>"), { name: "join", ref: "" });
});

test("claimPendingInvite posts the stored ref once and clears it whatever the answer", async () => {
  const storage = memoryStorage();
  rememberInviteRef(storage, "alice");
  assert.equal(storage.getItem(INVITE_REF_KEY), "alice");
  rememberInviteRef(storage, "<bad>");
  assert.equal(storage.getItem(INVITE_REF_KEY), "alice", "an invalid ref never overwrites");
  const calls = [];
  const api = async (path, options) => { calls.push([path, options]); return { inviter: "alice" }; };
  assert.equal(await claimPendingInvite(api, storage), "alice");
  assert.deepEqual(calls, [["/api/me/invite", { method: "POST", body: { ref: "alice" } }]]);
  assert.equal(storage.getItem(INVITE_REF_KEY), null);
  assert.equal(await claimPendingInvite(api, storage), null, "nothing pending: no request");
  assert.equal(calls.length, 1);
  rememberInviteRef(storage, "bob");
  assert.equal(await claimPendingInvite(async () => { throw new Error("offline"); }, storage), null);
  assert.equal(storage.getItem(INVITE_REF_KEY), null);
  rememberInviteRef(storage, "bob");
  clearAllInvite(storage);
  assert.equal(storage.getItem(INVITE_REF_KEY), null);
});

test("the invite panel shows the member's own link and copies it", async () => {
  const document = makeFakeDocument();
  const written = [];
  const panel = createInvitePanel(document, ORIGIN, "alice", { clipboard: { writeText: async (v) => { written.push(v); } } });
  const field = panel.querySelector("input");
  assert.equal(field.value, ORIGIN + "/join?ref=alice");
  assert.equal(field.hasAttribute("readonly"), true);
  await findByClass(panel, "invite-copy").fire("click");
  assert.deepEqual(written, [ORIGIN + "/join?ref=alice"]);
});

test("wiring pins: sign-out wipe, thread page mount, settings panel, welcome line, no third-party script", () => {
  const nav = read("public/js/routes/account-nav.js");
  assert.match(nav, /clearAllShare\(\)/);
  assert.match(nav, /clearAllInvite\(\)/);
  assert.match(read("public/js/routes/post.js"), /createShareButton\(/);
  assert.match(read("public/js/routes/feed.js"), /createInvitePanel\(/);
  assert.match(read("public/js/newcomer.js"), /invitedBy/);
  const share = read("public/js/share.js");
  assert.doesNotMatch(share, /api\(|fetch\(|XMLHttpRequest|<script|createElement\("script"\)|innerHTML/);
  assert.doesNotMatch(read("public/js/invite.js"), /innerHTML|fetch\(/);
  const html = read("public/index.html");
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
});
