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

// Wave 5.8: security review of v5.4.0..v5.7.0 (docs/drafts/security-review-5.8.md).
// One fix (caps guard lowered an upper-case-scheme link it promised to keep)
// plus regression pins on the riskiest client surfaces the range added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toSentenceCase, isShouting } from "../public/js/caps-guard.js";
import { createBoardRegulars } from "../public/js/board-regulars.js";
import { replyMatches } from "../public/js/reply-filter.js";
import { APPEARANCE_KEYS, resetAppearance } from "../public/js/appearance-reset.js";
import { countByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("caps guard keeps a link exactly as typed even with an upper-case scheme", () => {
  const url = "HTTPS://EXAMPLE.COM/Path/AbC?Q=1";
  const out = toSentenceCase("PLEASE READ THIS " + url + " RIGHT NOW");
  assert.ok(out.includes(url), "the link survives the rewrite byte-for-byte: " + out);
  assert.ok(out.startsWith("Please read this "));
  const mixed = "Http://Example.com/XyZ";
  assert.equal(toSentenceCase("LOOK AT " + mixed), "Look at " + mixed);
  // A shouted link alone never counts toward the shouting ratio.
  assert.equal(isShouting("ok " + "HTTPS://EXAMPLE.COM/AAAAAAAAAAAAAAAAAAAA"), false);
});

test("caps guard output is plain text: markup in the draft is never interpreted", () => {
  const draft = "<IMG SRC=X ONERROR=ALERT(1)> HELLO EVERYONE THIS IS LOUD";
  const out = toSentenceCase(draft);
  assert.equal(out.toLowerCase(), draft.toLowerCase(), "only letter case changes");
  assert.equal(out.length, draft.length);
});

test("board regulars: crafted usernames stay text and cannot leave /users/", () => {
  const doc = makeFakeDocument();
  const evil = "<img src=x onerror=alert(1)>";
  const dots = "../admin";
  const author = (id, username) => ({ author: { id, username } });
  const line = createBoardRegulars(doc, [author(1, evil), author(1, evil), author(2, dots), author(2, dots)]);
  assert.equal(countByClass(line, "board-regular"), 2);
  const links = Array.from(line.children).filter((node) => node.className === "board-regular");
  assert.equal(links.length, 2);
  const byText = new Map(links.map((link) => [link.textContent, link.getAttribute("href")]));
  assert.equal(byText.get(evil), "/users/" + encodeURIComponent(evil));
  assert.equal(byText.get(dots), "/users/..%2Fadmin", "a slash is encoded, so the link cannot climb out");
  for (const link of links) {
    assert.equal(link.children.length, 0, "the name is a text node, never parsed markup");
    assert.ok(link.getAttribute("href").startsWith("/users/"));
  }
  const source = read("public/js/board-regulars.js");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test("board regulars are never drawn on the staff-only Updates category", () => {
  const source = read("public/js/routes/feed.js");
  assert.match(source, /board\.staffOnly \? null : createBoardRegulars\(document, data\.feed\.posts\)/);
});

test("reply filter treats regex metacharacters literally (no RegExp from user input)", () => {
  assert.equal(replyMatches("plain words", ".*"), false);
  assert.equal(replyMatches("price is $5 (approx.)", "$5 (approx.)"), true);
  assert.equal(replyMatches("a[b", "["), true);
  assert.equal(replyMatches("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "(a+)+$"), false);
  assert.equal(replyMatches("hidden ||secret|| text", "secret"), false, "spoilers stay masked");
  const source = read("public/js/reply-filter.js");
  assert.doesNotMatch(source, /new RegExp|innerHTML|insertAdjacentHTML/);
});

test("appearance reset writes only the three device-pref keys and survives blocked storage", () => {
  assert.deepEqual([...APPEARANCE_KEYS].sort(), ["forum-corners", "forum-tab-unread", "forum-text-size"]);
  for (const key of APPEARANCE_KEYS) assert.doesNotMatch(key, /:u\d|theme/);
  const written = [];
  const storage = { setItem: (key) => { written.push(key); throw new Error("blocked"); } };
  const doc = makeFakeDocument();
  doc.documentElement = { dataset: {}, style: { setProperty() {}, removeProperty() {} } };
  doc.title = "(3) Forum";
  assert.doesNotThrow(() => resetAppearance(doc, storage));
  assert.deepEqual(written.sort(), [...APPEARANCE_KEYS].sort());
  assert.equal(doc.documentElement.dataset.corners, "round");
});

test("renderRoute turns only a post-route 404 into not-found; every other error still surfaces", () => {
  const source = read("public/js/app.js");
  const guard = 'if (route.name !== "post" || error?.status !== 404 || version !== state.renderVersion) throw error;';
  assert.ok(source.includes(guard), "401/403/500 and non-post routes rethrow to the error bar");
  const body = source.match(/async function renderRoute\(route\) \{([\s\S]*?)\n\}/)[1];
  assert.equal((body.match(/catch \(error\)/g) || []).length, 1, "a single, narrow catch");
});

test("the only replace navigation is the post-delete hop to a fixed path", () => {
  const profile = read("public/js/routes/profile.js");
  const hits = [...read("public/js/routes/profile.js").matchAll(/navigate\(([^)]*)\{ replace: true \}\)/g)];
  assert.equal(hits.length, 1);
  assert.equal(hits[0][1].trim(), '"/",');
  assert.ok(profile.includes('state.router.navigate("/", { replace: true });'));
});

test("claude-code-action stays pinned to a full commit SHA in every workflow", () => {
  for (const file of ["claude.yml", "claude-code-review.yml"]) {
    const yml = read(".github/workflows/" + file);
    assert.match(yml, /anthropics\/claude-code-action@[0-9a-f]{40}\b/, file);
    assert.doesNotMatch(yml, /contents: write|pull-requests: write|issues: write/, file + " stays read-only");
  }
});
