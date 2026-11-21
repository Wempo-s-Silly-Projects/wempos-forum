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


// Wave 2026-11-21-4 F2 (copy link) + F3 (reader text size): both client-only,
// opt-in per click, nothing stored server-side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPIED_STATUS_MS, createCopyLinkButton, postPermalink } from "../public/js/copy-link.js";
import {
  TEXT_SIZES, TEXT_SIZE_STORAGE_KEY, applyTextSize, createTextSizePicker, normalizeTextSize, readTextSize,
} from "../public/js/text-size.js";

import { makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const fakeDocument = makeFakeDocument({ documentElement: { dataset: {} } });
const memoryStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data,
  };
};
const throwingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
};


// --- F2: copy link ---------------------------------------------------------------

test("postPermalink builds an absolute same-origin /posts/<id> link from numeric ids only", () => {
  assert.equal(postPermalink("https://wempos-forum.com", 42), "https://wempos-forum.com/posts/42");
  assert.equal(postPermalink("https://wempos-forum.com", "7"), "https://wempos-forum.com/posts/7");
  assert.equal(postPermalink("https://wempos-forum.com", "7/../admin"), null);
  assert.equal(postPermalink("https://wempos-forum.com", -1), null);
});

test("copy-link button writes the permalink and announces it in a polite status", async () => {
  const written = [];
  const timers = [];
  const wrap = createCopyLinkButton(fakeDocument, 42, {
    origin: "https://wempos-forum.com",
    clipboard: { writeText: async (text) => { written.push(text); } },
    schedule: (fn, ms) => timers.push([fn, ms]),
  });
  const button = findByClass(wrap, "copy-link");
  assert.equal(button.type, "button");
  assert.ok(button.getAttribute("aria-label"));
  await button.fire("click");
  assert.deepEqual(written, ["https://wempos-forum.com/posts/42"]);
  const status = findByClass(wrap, "copy-link-status");
  assert.ok(status, "a status node is painted");
  assert.equal(status.getAttribute("role"), "status");
  assert.ok(status.textContent.length > 0);
  assert.equal(timers[0][1], COPIED_STATUS_MS);
  timers[0][0]();
  assert.equal(status.textContent, "", "the status clears itself");
});

test("copy-link falls back to a failure status when the clipboard is missing or refuses", async () => {
  for (const clipboard of [null, { writeText: async () => { throw new Error("denied"); } }]) {
    const wrap = createCopyLinkButton(fakeDocument, 9, {
      origin: "https://wempos-forum.com", clipboard, schedule: () => {},
    });
    const button = findByClass(wrap, "copy-link");
    await button.fire("click");
    const status = findByClass(wrap, "copy-link-status");
    assert.ok(status && status.textContent.length > 0);
    assert.equal(button.dataset.copied, "false");
  }
});

test("render.js mounts the copy-link button on every post card", () => {
  const source = read("public/js/render.js");
  assert.match(source, /from "\.\/copy-link\.js"/);
  assert.match(source, /actions\.append\(createCopyLinkButton\(document, post\.id\)\)/);
});

// --- F3: reader text size -------------------------------------------------------

test("normalizeTextSize accepts the three sizes and folds everything else to default", () => {
  assert.deepEqual(TEXT_SIZES, ["default", "large", "larger"]);
  assert.equal(normalizeTextSize("large"), "large");
  assert.equal(normalizeTextSize("larger"), "larger");
  assert.equal(normalizeTextSize("huge"), "default");
  assert.equal(normalizeTextSize(null), "default");
});

test("readTextSize/applyTextSize survive blocked storage and paint data-text-size", () => {
  assert.equal(readTextSize(throwingStorage), "default");
  assert.equal(readTextSize(memoryStorage({ [TEXT_SIZE_STORAGE_KEY]: "larger" })), "larger");
  const doc = { documentElement: { dataset: {} } };
  applyTextSize(doc, "large");
  assert.equal(doc.documentElement.dataset.textSize, "large");
  applyTextSize(doc, "bogus");
  assert.equal(doc.documentElement.dataset.textSize, "default");
});

test("the picker shows the stored size, and a change stores + applies it", async () => {
  const storage = memoryStorage({ [TEXT_SIZE_STORAGE_KEY]: "large" });
  const doc = { ...fakeDocument, documentElement: { dataset: {} } };
  const picker = createTextSizePicker(doc, storage);
  const select = Array.from(picker.children).find((child) => child.tagName === "SELECT");
  assert.equal(select.children.length, 3);
  assert.equal(select.value, "large");
  select.value = "larger";
  await select.fire("change");
  assert.equal(storage.data.get(TEXT_SIZE_STORAGE_KEY), "larger");
  assert.equal(doc.documentElement.dataset.textSize, "larger");
  assert.doesNotThrow(() => createTextSizePicker(doc, throwingStorage));
});

test("text size is preloaded before paint, scales rem-based CSS, and lives in account settings", () => {
  const preload = read("public/js/theme-preload.js");
  assert.match(preload, /forum-text-size/);
  const css = read("public/styles.css");
  assert.match(css, /:root\[data-text-size="large"\]\s*\{\s*font-size: 112\.5%;/);
  assert.match(css, /:root\[data-text-size="larger"\]\s*\{\s*font-size: 125%;/);
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /createTextSizePicker\(document/);
  assert.match(feed, /appearance\.append\(corners, createTextSizePicker/);
});
