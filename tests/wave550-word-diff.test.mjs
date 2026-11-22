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

// Wave 5.50 (v5.50.0) — the word diff in the edit history panel. Client only:
// diffWords(a, b) is a pure word-level LCS with an O(n·m) bound guard (either
// side over DIFF_MAX_WORDS words → null → the plain full-version view). The
// panel diffs the MASKED text of both versions, builds <ins>/<del> through
// createElement + textContent, and the stored edits never change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import { LINEAR_GROWTH_CEILING, bestOf, growthRatio } from "./helpers/timing.mjs";
import { DIFF_MAX_WORDS, diffWords } from "../public/js/word-diff.js";
import { renderEditHistoryPanel } from "../public/js/render.js";
import { maskSpoilers } from "../public/js/markdown.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const words = (n, prefix = "w") => Array.from({ length: n }, (_, i) => prefix + i).join(" ");
const rebuild = (parts, keep) => parts.filter((p) => keep.includes(p.type)).map((p) => p.text).join("");

test("diffWords: equal, insert, delete and replace at word level, merged runs", () => {
  assert.deepEqual(diffWords("same text", "same text"), [{ type: "equal", text: "same text" }]);
  assert.deepEqual(diffWords("the cat sat", "the black cat sat"),
    [{ type: "equal", text: "the " }, { type: "insert", text: "black " }, { type: "equal", text: "cat sat" }]);
  assert.deepEqual(diffWords("the black cat sat", "the cat sat"),
    [{ type: "equal", text: "the " }, { type: "delete", text: "black " }, { type: "equal", text: "cat sat" }]);
  const replaced = diffWords("I like red apples", "I like green pears");
  assert.deepEqual(replaced.map((p) => p.type), ["equal", "delete", "insert"]);
  assert.equal(rebuild(replaced, ["equal", "delete"]), "I like red apples");
  assert.equal(rebuild(replaced, ["equal", "insert"]), "I like green pears");
  assert.deepEqual(diffWords("", "new words"), [{ type: "insert", text: "new words" }]);
  assert.deepEqual(diffWords("old words", ""), [{ type: "delete", text: "old words" }]);
  assert.deepEqual(diffWords("", ""), []);
});

test("diffWords: equal+delete rebuilds the old words and equal+insert the exact new text, line breaks kept (random pairs)", () => {
  let seed = 550;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const vocab = ["a", "b", "c", "dd", "ee", "a\n", "b\n\n", "ff "];
  const text = () => Array.from({ length: Math.floor(rand() * 30) }, () => vocab[Math.floor(rand() * vocab.length)]).join(" ").trim();
  for (let i = 0; i < 300; i++) {
    const a = text();
    const b = text();
    const parts = diffWords(a, b);
    const wordsOf = (s) => s.split(/\s+/).filter(Boolean);
    assert.deepEqual(wordsOf(rebuild(parts, ["equal", "delete"])), wordsOf(a), "old " + JSON.stringify([a, b]));
    assert.equal(rebuild(parts, ["equal", "insert"]), b, "new " + JSON.stringify([a, b]));
    for (let k = 1; k < parts.length; k++) assert.notEqual(parts[k].type, parts[k - 1].type, "runs merged");
  }
});

test("diffWords: the bound guard — either side over DIFF_MAX_WORDS words returns null; non-strings are text", () => {
  assert.equal(DIFF_MAX_WORDS, 2000);
  assert.ok(Array.isArray(diffWords(words(DIFF_MAX_WORDS), words(DIFF_MAX_WORDS, "v"))));
  assert.equal(diffWords(words(DIFF_MAX_WORDS + 1), "short"), null);
  assert.equal(diffWords("short", words(DIFF_MAX_WORDS + 1)), null);
  assert.deepEqual(diffWords(null, undefined), []);
});

test("timing pin: over the cap is linear; a small edit in a long body is linear; the worst case at the cap stays bounded", () => {
  const over = (n) => [words(n), words(n, "v")];
  const overRatio = growthRatio(([a, b]) => diffWords(a, b), over(DIFF_MAX_WORDS + 500), over(4 * (DIFF_MAX_WORDS + 500)));
  assert.ok(overRatio.ratio < LINEAR_GROWTH_CEILING, "over-cap guard " + overRatio.ratio.toFixed(1) + "x");
  const edit = (n) => [words(n), words(n).replace("w" + Math.floor(n / 2) + " ", "changed ")];
  const editRatio = growthRatio(([a, b]) => diffWords(a, b), edit(400), edit(1600));
  assert.ok(editRatio.ratio < LINEAR_GROWTH_CEILING, "small edit " + editRatio.ratio.toFixed(1) + "x");
  const worst = bestOf(() => diffWords(words(DIFF_MAX_WORDS), words(DIFF_MAX_WORDS, "v")), 3);
  assert.ok(worst < 1500, "worst case at the cap " + worst.toFixed(0) + " ms");
});

test("panel: each version diffs against the one before it; the oldest stays plain; the current version leads", () => {
  const doc = makeFakeDocument();
  const edits = [
    { editedAt: "2026-11-21T12:00:00Z", body: "the quick brown fox" },
    { editedAt: "2026-11-20T12:00:00Z", body: "the slow brown fox" },
  ];
  const panel = renderEditHistoryPanel(doc, edits, "the quick red fox");
  const entries = panel.children ? [...panel.children].filter((n) => String(n.className).includes("edit-history-entry")) : [];
  assert.equal(entries.length, 3);
  assert.equal(findByClass(entries[0], "edit-history-time").textContent, t("render.currentVersion"));
  // Current vs newest past: brown -> red.
  assert.equal(findByClass(entries[0], "edit-diff-del").tagName.toLowerCase(), "del");
  assert.equal(findByClass(entries[0], "edit-diff-del").textContent.trim(), "brown");
  assert.equal(findByClass(entries[0], "edit-diff-ins").tagName.toLowerCase(), "ins");
  assert.equal(findByClass(entries[0], "edit-diff-ins").textContent.trim(), "red");
  // Newest past vs oldest: slow -> quick.
  assert.equal(findByClass(entries[1], "edit-diff-del").textContent.trim(), "slow");
  assert.equal(findByClass(entries[1], "edit-diff-ins").textContent.trim(), "quick");
  // The oldest has nothing before it: plain text, no marks.
  assert.equal(countByClass(entries[2], "edit-diff-ins") + countByClass(entries[2], "edit-diff-del"), 0);
  assert.equal(findByClass(entries[2], "edit-history-body").textContent, "the slow brown fox");
});

test("panel: without a current body the past versions still diff; one version is plain; empty keeps the placeholder", () => {
  const doc = makeFakeDocument();
  const two = renderEditHistoryPanel(doc, [
    { editedAt: "2026-11-21T12:00:00Z", body: "b c" }, { editedAt: "2026-11-20T12:00:00Z", body: "a c" }]);
  assert.equal(countByClass(two, "edit-history-entry"), 2);
  assert.equal(countByClass(two, "edit-diff-ins"), 1);
  const one = renderEditHistoryPanel(doc, [{ editedAt: "2026-11-21T12:00:00Z", body: "only" }]);
  assert.equal(countByClass(one, "edit-diff-ins") + countByClass(one, "edit-diff-del"), 0);
  assert.equal(findByClass(one, "edit-history-body").textContent, "only");
  const empty = renderEditHistoryPanel(doc, [], "current");
  assert.equal(findByClass(empty, "edit-history-empty").textContent, t("render.noEarlierVersions"));
  assert.equal(countByClass(empty, "edit-history-entry"), 0);
});

test("panel: spoilers stay masked in BOTH versions — the diff runs on the masked text", () => {
  const doc = makeFakeDocument();
  const panel = renderEditHistoryPanel(doc, [
    { editedAt: "2026-11-21T12:00:00Z", body: "intro ||the butler did it|| outro" },
    { editedAt: "2026-11-20T12:00:00Z", body: "intro ||the gardener did it|| end" },
  ], "intro ||the cook did it|| final");
  const text = panel.textContent;
  for (const secret of ["butler", "gardener", "cook", "did it"]) assert.ok(!text.includes(secret), "leaks " + secret);
  assert.ok(text.includes("final") && text.includes("outro") && text.includes("end"));
  const masked = maskSpoilers("intro ||the cook did it|| final");
  assert.ok(!masked.includes("cook"));
});

test("panel: past the bound guard the version falls back to the plain full text", () => {
  const doc = makeFakeDocument();
  const long = words(DIFF_MAX_WORDS + 1);
  const panel = renderEditHistoryPanel(doc, [
    { editedAt: "2026-11-21T12:00:00Z", body: long }, { editedAt: "2026-11-20T12:00:00Z", body: "short" }]);
  const first = [...panel.children].filter((n) => String(n.className).includes("edit-history-entry"))[0];
  assert.equal(countByClass(first, "edit-diff-ins") + countByClass(first, "edit-diff-del"), 0);
  assert.equal(findByClass(first, "edit-history-body").textContent, long);
});

test("source pins: createElement + textContent only, no storage or network, and the edit route passes the current body", () => {
  const src = read("public/js/word-diff.js");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|api\(|fetch\(/);
  assert.match(src, /createElement\(/);
  assert.match(read("public/js/render.js"), /maskSpoilers\(older\)[\s\S]{0,80}maskSpoilers\(newer\)|maskSpoilers\(newer\)[\s\S]{0,80}maskSpoilers\(older\)/);
  assert.match(read("public/js/routes/post.js"), /renderEditHistoryPanel\(document, data\.edits, article\.postBody\)/);
  // Edits are stored exactly as before: the edit route is untouched by this wave.
  assert.doesNotMatch(read("api/posts-write.mjs"), /diff/i);
});
