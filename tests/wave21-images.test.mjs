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

// Wave 2026-11-21-21: images & gallery. F1 the lightbox viewer (step keys,
// counter, controls, focus return) driven through fake-dom; F2/F3 the pure
// gallery recents + sort helpers (scoping, visibility filter, wipe); static
// pins for the wiring; and the new strings in all 21 locales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openLightbox, stepIndex, stripThumbs } from "../public/js/lightbox.js";
import {
  MAX_RECENT_GALLERY, RECENTS_STORAGE_KEY, arrangeGallery, clearAllRecents,
  readRecents, recentsKey, rememberRecents, writeRecents,
} from "../public/js/gallery-picks.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
const blockedStorage = {
  get length() { throw new Error("blocked"); },
  key() { throw new Error("blocked"); },
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};

// --- F1 lightbox ---------------------------------------------------------

test("stepIndex: arrows clamp at the ends, Home/End jump, other keys are ignored", () => {
  assert.equal(stepIndex(0, 3, "ArrowRight"), 1);
  assert.equal(stepIndex(2, 3, "ArrowRight"), 2);
  assert.equal(stepIndex(0, 3, "ArrowLeft"), 0);
  assert.equal(stepIndex(1, 3, "Home"), 0);
  assert.equal(stepIndex(0, 3, "End"), 2);
  assert.equal(stepIndex(0, 3, "Enter"), null);
  assert.equal(stepIndex(0, 1, "ArrowRight"), null);
});

test("stepIndex: right-to-left pages mirror the arrows", () => {
  assert.equal(stepIndex(0, 3, "ArrowLeft", true), 1);
  assert.equal(stepIndex(1, 3, "ArrowRight", true), 0);
});

const buildStrip = (count) => {
  const article = new FakeNode("article");
  const strip = new FakeNode("div");
  strip.className = "post-attachments";
  const thumbs = Array.from({ length: count }, (_, index) => {
    const button = new FakeNode("button");
    button.className = "attachment-expand";
    const img = new FakeNode("img");
    img.className = "post-attachment";
    img.src = `/api/attachments/a${index}?v=1`;
    button.append(img);
    strip.append(button);
    return button;
  });
  article.append(strip);
  return { strip, thumbs };
};
const buildDialog = () => {
  const dialog = new FakeNode("dialog");
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; dialog.modalCalls = (dialog.modalCalls ?? 0) + 1; };
  dialog.close = () => { dialog.open = false; dialog.dispatch("close"); };
  dialog.append(new FakeNode("img"));
  return dialog;
};

test("stripThumbs: only the clicked button's own strip, in order", () => {
  const first = buildStrip(3);
  buildStrip(2);
  assert.deepEqual(stripThumbs(first.thumbs[1]), first.thumbs);
  assert.deepEqual(stripThumbs(null), []);
});

test("lightbox: opens on the clicked image with controls, counter and a modal dialog", () => {
  const { thumbs } = buildStrip(3);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[1], makeFakeDocument());
  const image = dialog.querySelector("img");
  assert.equal(dialog.open, true);
  assert.equal(image.src, "/api/attachments/a1?v=1");
  const counter = dialog.querySelector(".lightbox-counter");
  assert.equal(counter.hidden, false);
  assert.ok(counter.textContent, "counter is filled (t() key without a loaded table)");
  assert.equal(counter.getAttribute("aria-live"), "polite");
  assert.ok(dialog.querySelector(".lightbox-close").ownerFocused, "focus starts on the close button");
  assert.ok(dialog.querySelector(".lightbox-previous").getAttribute("aria-label"));
});

test("lightbox: arrow keys and the step buttons walk the strip; ends disable", () => {
  const { thumbs } = buildStrip(3);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  const image = dialog.querySelector("img");
  const previous = dialog.querySelector(".lightbox-previous");
  const next = dialog.querySelector(".lightbox-next");
  assert.equal(previous.disabled, true);
  let prevented = false;
  dialog.dispatch("keydown", { key: "ArrowRight", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(image.src, "/api/attachments/a1?v=1");
  next.dispatch("click");
  assert.equal(image.src, "/api/attachments/a2?v=1");
  assert.equal(next.disabled, true);
  previous.dispatch("click");
  assert.equal(image.src, "/api/attachments/a1?v=1");
  dialog.dispatch("keydown", { key: "Home", preventDefault() {} });
  assert.equal(image.src, "/api/attachments/a0?v=1");
});

test("lightbox: closing returns focus to the LAST-viewed thumbnail", () => {
  const { thumbs } = buildStrip(3);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  dialog.dispatch("keydown", { key: "End", preventDefault() {} });
  dialog.querySelector(".lightbox-close").dispatch("click");
  assert.equal(dialog.open, false);
  assert.ok(thumbs[2].ownerFocused);
  assert.ok(!thumbs[0].ownerFocused);
});

test("lightbox: backdrop/image clicks close; counter clicks do not; one image hides the steps", () => {
  const { thumbs } = buildStrip(1);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  assert.equal(dialog.querySelector(".lightbox-next").hidden, true);
  assert.equal(dialog.querySelector(".lightbox-counter").hidden, true);
  dialog.dispatch("click", { target: dialog.querySelector(".lightbox-counter") });
  assert.equal(dialog.open, true);
  dialog.dispatch("click", { target: dialog });
  assert.equal(dialog.open, false);
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  assert.equal(dialog.querySelectorAll(".lightbox-close").length, 1, "controls are built once");
  dialog.dispatch("click", { target: dialog.querySelector("img") });
  assert.equal(dialog.open, false);
});

test("lightbox wiring: post.js opens through lightbox.js; app.js dropped click-anywhere close", () => {
  assert.match(read("public/js/routes/post.js"), /openLightbox\(attachmentLightbox, button\)/);
  assert.doesNotMatch(read("public/js/app.js"), /attachmentLightbox\?\.addEventListener/);
  const css = read("public/styles.css");
  assert.match(css, /prefers-reduced-motion: no-preference\)\s*\{\s*\.attachment-lightbox\[open\] img/);
});

// --- F2/F3 gallery -------------------------------------------------------

test("recents: no account id means no key, no read, no write", () => {
  const storage = memoryStorage();
  assert.equal(recentsKey(null), null);
  writeRecents(storage, [id(1)], null);
  assert.deepEqual(storage.dump(), {});
  assert.deepEqual(readRecents(storage, null), []);
});

test("recents: account-scoped round trip; junk and bad shapes dropped; blocked storage is safe", () => {
  const storage = memoryStorage({ [RECENTS_STORAGE_KEY + ":u7"]: JSON.stringify([id(1), "x", 4, id(2)]) });
  assert.deepEqual(readRecents(storage, 7), [id(1), id(2)]);
  assert.deepEqual(readRecents(storage, 8), []);
  assert.deepEqual(readRecents(memoryStorage({ [RECENTS_STORAGE_KEY + ":u7"]: "{bad" }), 7), []);
  writeRecents(storage, [id(3)], 8);
  assert.deepEqual(JSON.parse(storage.dump()[RECENTS_STORAGE_KEY + ":u8"]), [id(3)]);
  assert.deepEqual(readRecents(blockedStorage, 7), []);
  assert.doesNotThrow(() => writeRecents(blockedStorage, [id(1)], 7));
  assert.doesNotThrow(() => clearAllRecents(blockedStorage));
});

test("rememberRecents: newest first, deduped, capped, input untouched", () => {
  const before = [id(1), id(2)];
  const after = rememberRecents(before, [id(2), id(3)]);
  assert.deepEqual(after, [id(2), id(3), id(1)]);
  assert.deepEqual(before, [id(1), id(2)]);
  const many = Array.from({ length: 12 }, (_, n) => id(n + 10));
  assert.equal(rememberRecents([], many).length, MAX_RECENT_GALLERY);
});

test("arrangeGallery: a recent id the approved list no longer carries never shows (visibility)", () => {
  const gifs = [{ id: id(1), useCount: 1 }, { id: id(2), useCount: 9 }];
  const { recent, rest } = arrangeGallery(gifs, [id(99), id(2)], "newest");
  assert.deepEqual(recent.map((gif) => gif.id), [id(2)]);
  assert.deepEqual(rest.map((gif) => gif.id), [id(1)], "recents are not repeated below");
});

test("arrangeGallery: popular sorts by use count, ties keep newest-first; newest keeps server order", () => {
  const gifs = [
    { id: id(1), useCount: 2 }, { id: id(2), useCount: 5 }, { id: id(3), useCount: 2 }, { id: id(4), useCount: 0 },
  ];
  const snapshot = JSON.stringify(gifs);
  assert.deepEqual(arrangeGallery(gifs, [], "popular").rest.map((gif) => gif.id), [id(2), id(1), id(3), id(4)]);
  assert.deepEqual(arrangeGallery(gifs, [], "newest").rest.map((gif) => gif.id), [id(1), id(2), id(3), id(4)]);
  assert.equal(JSON.stringify(gifs), snapshot);
  assert.deepEqual(arrangeGallery(null, [id(1)]), { recent: [], rest: [] });
});

test("clearAllRecents wipes every account's recents and leaves other keys", () => {
  const storage = memoryStorage({
    [RECENTS_STORAGE_KEY + ":u1"]: "[]", [RECENTS_STORAGE_KEY + ":u2"]: "[]", "forum-chat-pins:u1": "[]",
  });
  clearAllRecents(storage);
  assert.deepEqual(Object.keys(storage.dump()), ["forum-chat-pins:u1"]);
});

test("gallery wiring: sign-out wipes recents; picker paints recents + sort; confirm records inserts", () => {
  assert.match(read("public/js/routes/account-nav.js"), /clearAllRecents\(\)/);
  const composer = read("public/js/routes/composer.js");
  assert.match(composer, /arrangeGallery\(galleryView\.gifs, recents, sort\)/);
  assert.match(composer, /writeRecents\(undefined, rememberRecents\(readRecents\(undefined, accountId\), added\), accountId\)/);
  const html = read("public/index.html");
  assert.match(html, /id="gif-sort"/);
  assert.match(html, /id="gif-recents"[^>]*role="listbox"[^>]*aria-labelledby="gif-recents-title"/);
});

// --- strings -------------------------------------------------------------

const NEW_KEYS = [
  "lightbox.previous", "lightbox.next", "lightbox.counter",
  "shell.galleryRecent", "shell.gallerySort", "shell.gallerySortNewest", "shell.gallerySortPopular",
];
const LOCALES = [
  "en", "es", "pt", "fr", "de", "it", "nl", "pl", "ru", "uk", "tr", "ar", "he", "hi", "id", "vi", "th",
  "ja", "ko", "zh-Hans", "zh-Hant",
];

test("wave-21 strings exist in all 21 locales, translated, placeholders intact", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const code of LOCALES) {
    const table = JSON.parse(read(`public/locales/${code}.json`));
    for (const key of NEW_KEYS) {
      assert.equal(typeof table[key], "string", `${code} ${key}`);
      assert.ok(table[key].trim(), `${code} ${key} empty`);
      if (code !== "en") assert.notEqual(table[key], en[key], `${code} ${key} untranslated`);
    }
    assert.match(table["lightbox.counter"], /\{index\}/, code);
    assert.match(table["lightbox.counter"], /\{total\}/, code);
  }
});
