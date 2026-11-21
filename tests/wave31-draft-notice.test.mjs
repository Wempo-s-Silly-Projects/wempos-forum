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

// Wave 2026-11-21-31 F2: a restored composer draft says so ("Restored your
// unsent draft (saved 5m ago)") with a Discard draft button that clears the
// box and the stored draft after a confirm. Client-only: it reads the
// existing account-scoped draft key, adds no storage key and no request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { DRAFT_PREFIX, attachDraftAutosave, draftKey, loadDraft, loadDraftEntry, saveDraft } from "../public/js/drafts.js";
import { createDraftNotice } from "../public/js/draft-notice.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["drafts.restored", "drafts.discard", "drafts.discardConfirm"];

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function composer(storage, key) {
  const form = new FakeNode("form");
  form.dataset = {};
  const textarea = new FakeNode("textarea");
  textarea.value = "";
  textarea.dispatchEvent = () => true;
  form.append(textarea);
  const restored = attachDraftAutosave(form, textarea, key, storage);
  return { form, textarea, restored };
}

test("loadDraftEntry returns body and savedAt; loadDraft keeps returning the body", () => {
  const storage = memoryStorage();
  const key = draftKey("reply", 9, null, 4);
  saveDraft(storage, key, "half a reply", 1_000);
  assert.deepEqual(loadDraftEntry(storage, key, 2_000), { body: "half a reply", savedAt: 1_000 });
  assert.equal(loadDraft(storage, key, 2_000), "half a reply");
  assert.equal(loadDraftEntry(storage, "missing", 2_000), null);
});

test("attachDraftAutosave reports a restore with its savedAt, and null otherwise", () => {
  const storage = memoryStorage();
  const key = draftKey("reply", 9, null, 4);
  assert.equal(composer(storage, key).restored, null, "nothing saved");
  saveDraft(storage, key, "unsent words");
  const { textarea, restored } = composer(storage, key);
  assert.equal(textarea.value, "unsent words");
  assert.ok(Number.isFinite(restored.savedAt));
});

test("the notice names the restore and Discard clears box + stored draft after confirm", () => {
  const document = makeFakeDocument();
  const storage = memoryStorage();
  const key = draftKey("reply", 9, null, 4);
  saveDraft(storage, key, "unsent words");
  const { form, textarea, restored } = composer(storage, key);
  let asked = 0;
  const notice = createDraftNotice(document, {
    form, textarea, savedAt: restored.savedAt, storage, confirmDiscard: () => { asked += 1; return true; },
  });
  assert.equal(notice.className, "draft-notice");
  assert.ok(findByClass(notice, "draft-notice-text").textContent.length > 0);
  const button = findByClass(notice, "draft-notice-discard");
  assert.equal(button.type, "button");
  button.dispatch("click");
  assert.equal(asked, 1);
  assert.equal(textarea.value, "");
  assert.equal(storage.getItem(key), null);
  assert.equal(notice.hidden, true);
  assert.equal(textarea.ownerFocused, true);
  assert.equal(form.dataset.draftKey, key, "autosave stays armed for new typing");
});

test("declining the confirm keeps the draft", () => {
  const document = makeFakeDocument();
  const storage = memoryStorage();
  const key = draftKey("post-create", null, null, 4);
  saveDraft(storage, key, "keep me");
  const { form, textarea, restored } = composer(storage, key);
  const notice = createDraftNotice(document, {
    form, textarea, savedAt: restored.savedAt, storage, confirmDiscard: () => false,
  });
  findByClass(notice, "draft-notice-discard").dispatch("click");
  assert.equal(textarea.value, "keep me");
  assert.ok(storage.getItem(key));
  assert.notEqual(notice.hidden, true);
});

test("the notice module is local-only: no request, no new storage key", () => {
  const src = read("public/js/draft-notice.js");
  assert.doesNotMatch(src, /api\(|fetch\(|setItem|sessionStorage/);
  assert.doesNotMatch(src, /innerHTML/);
  assert.ok(read("public/js/drafts.js").includes('DRAFT_PREFIX = "forum-draft:"'));
  assert.equal(DRAFT_PREFIX, "forum-draft:");
});

test("composers show the notice only when a draft was restored", () => {
  const src = read("public/js/routes/composer.js");
  assert.match(src, /const restoredDraft = attachDraftAutosave\(/);
  assert.match(src, /if \(restoredDraft\) form\.append\(createDraftNotice\(document, \{/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/draft-notice\.js">/);
  assert.match(read("public/styles.css"), /\.draft-notice\b/);
});

test("new strings exist in en and are translated in all 20 locales", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of NEW_KEYS) assert.equal(typeof en[key], "string", key);
  assert.match(en["drafts.restored"], /\{when\}/);
  const locales = ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant",
    "bg", "bn", "ca", "cs", "da", "el", "fa", "fi", "fil", "hr", "hu", "ms", "nb", "ro", "sk", "sr", "sv", "sw", "ta", "ur"];
  for (const locale of locales) {
    const bundle = JSON.parse(read("public/locales/" + locale + ".json"));
    for (const key of NEW_KEYS) {
      assert.equal(typeof bundle[key], "string", locale + " " + key);
      assert.notEqual(bundle[key], en[key], locale + " " + key + " untranslated");
    }
    assert.match(bundle["drafts.restored"], /\{when\}/, locale);
  }
});
