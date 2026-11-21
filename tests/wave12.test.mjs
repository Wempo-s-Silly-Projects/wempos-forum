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

// Wave 2026-11-21-12: the three wave-11 review LOWs (pins never touch an
// unscoped key, read aloud never queues two posts, J/K under Caps Lock) and
// two member features — fold a reply, and jump back to the first post.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PINS_STORAGE_KEY, pinsKey, readPins, writePins } from "../public/js/chat-pins.js";
import { createReadAloud } from "../public/js/read-aloud.js";
import { postKeyStep } from "../public/js/post-keys.js";
import { createFirstPostJump, LATEST_JUMP_MIN_REPLIES } from "../public/js/latest-reply.js";
import { addReplyFolds, FOLD_BUTTON_CLASS } from "../public/js/reply-fold.js";
import { FakeNode, makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
    data,
  };
};

// --- F1a: pins wait for the account id ------------------------------------------

test("pins: no account id means no key — nothing is read or written", () => {
  assert.equal(pinsKey(null), null);
  assert.equal(pinsKey(undefined), null);
  const storage = memoryStorage();
  storage.setItem(PINS_STORAGE_KEY, JSON.stringify(["dm:1"]));
  assert.deepEqual(readPins(storage, null), [], "a leftover unscoped key is never read");
  writePins(storage, ["dm:2"], null);
  writePins(storage, ["dm:3"], undefined);
  assert.deepEqual([...storage.data.keys()], [PINS_STORAGE_KEY], "nothing new is written");
  assert.equal(storage.getItem(PINS_STORAGE_KEY), JSON.stringify(["dm:1"]));
});

test("pins: the chat header offers no pin toggle until the account id is known", () => {
  const composer = read("public/js/chat-widget-composer.js");
  assert.match(composer, /if \(!accountId\) return \[\];/);
});

// --- F1b: read aloud never queues two posts -------------------------------------

function slowVoiceSynth() {
  const listeners = [];
  let voices = [];
  const synth = {
    spoken: [],
    cancelled: 0,
    getVoices: () => voices,
    addEventListener(type, fn) { if (type === "voiceschanged") listeners.push(fn); },
    removeEventListener() {},
    speak(utterance) { synth.spoken.push(utterance); },
    cancel() { synth.cancelled += 1; },
    deliver(list) { voices = list; listeners.splice(0).forEach((fn) => fn()); },
  };
  return synth;
}
class FakeUtterance { constructor(text) { this.text = text; } }

test("read aloud: two Listen clicks while voices load speak only the latest post", async () => {
  const synth = slowVoiceSynth();
  const options = { synth, Utterance: FakeUtterance, lang: "en", voiceWaitMs: 50 };
  const first = findByClass(createReadAloud(fakeDocument, () => "First post", options), "read-aloud-button");
  const second = findByClass(createReadAloud(fakeDocument, () => "Second post", options), "read-aloud-button");
  const pendingFirst = first.fire("click");
  const pendingSecond = second.fire("click");
  synth.deliver([{ name: "local-en", lang: "en-US", localService: true }]);
  await Promise.all([pendingFirst, pendingSecond]);
  assert.deepEqual(synth.spoken.map((u) => u.text), ["Second post"]);
  assert.equal(first.getAttribute("aria-pressed"), "false");
  assert.equal(second.getAttribute("aria-pressed"), "true");
});

test("read aloud: a late end event from a cancelled post does not reset the new one", async () => {
  const synth = slowVoiceSynth();
  synth.deliver([{ name: "local-en", lang: "en-US", localService: true }]);
  const options = { synth, Utterance: FakeUtterance, lang: "en", voiceWaitMs: 0 };
  const first = findByClass(createReadAloud(fakeDocument, () => "One", options), "read-aloud-button");
  const second = findByClass(createReadAloud(fakeDocument, () => "Two", options), "read-aloud-button");
  await first.fire("click");
  await second.fire("click");
  synth.spoken[0].onend();
  assert.equal(second.getAttribute("aria-pressed"), "true");
  assert.equal(first.getAttribute("aria-pressed"), "false");
});

// --- F1c: J/K under Caps Lock -----------------------------------------------------

const keyEvent = (key, extra = {}) => ({
  key, target: new FakeNode("button"), defaultPrevented: false, preventDefault() {}, ...extra,
});

test("J/K: Caps Lock letters still step; modifiers still block", () => {
  assert.equal(postKeyStep(keyEvent("J")), 1);
  assert.equal(postKeyStep(keyEvent("K")), -1);
  assert.equal(postKeyStep(keyEvent("J", { shiftKey: true })), 0);
  assert.equal(postKeyStep(keyEvent("j", { shiftKey: true })), 0, "Caps Lock + Shift is still Shift");
  for (const mod of ["altKey", "ctrlKey", "metaKey"]) assert.equal(postKeyStep(keyEvent("K", { [mod]: true })), 0);
  assert.equal(postKeyStep(keyEvent(undefined)), 0);
});

// --- F2: fold a reply ----------------------------------------------------------------

const replyCard = (id) => {
  const card = new FakeNode("article");
  card.className = "post-card";
  card.dataset.postId = String(id);
  const header = new FakeNode("header");
  header.className = "post-header";
  const body = new FakeNode("div");
  body.className = "post-body";
  card.append(header, body);
  return card;
};

test("fold: every reply card gets one Fold toggle in its header, idempotently", () => {
  const list = new FakeNode("div");
  list.append(replyCard(1), replyCard(2));
  addReplyFolds(fakeDocument, list);
  addReplyFolds(fakeDocument, list);
  assert.equal(countByClass(list, FOLD_BUTTON_CLASS), 2);
  const button = findByClass(list, FOLD_BUTTON_CLASS);
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.ok(button.textContent.length > 0);
  assert.equal(button.parentNode.className, "post-header");
  assert.doesNotThrow(() => addReplyFolds(fakeDocument, null));
});

test("fold: the toggle folds and unfolds its own card only, label unchanged", () => {
  const list = new FakeNode("div");
  const [one, two] = [replyCard(1), replyCard(2)];
  list.append(one, two);
  addReplyFolds(fakeDocument, list);
  const button = findByClass(one, FOLD_BUTTON_CLASS);
  const label = button.textContent;
  button.dispatch("click");
  assert.equal(one.hasAttribute("data-folded"), true);
  assert.equal(two.hasAttribute("data-folded"), false);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.textContent, label, "aria-pressed alone carries the state");
  button.dispatch("click");
  assert.equal(one.hasAttribute("data-folded"), false);
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("fold: wired on every reply paint and hidden by CSS, nothing stored", () => {
  const post = read("public/js/routes/post.js");
  assert.equal((post.match(/addReplyFolds\(document, /g) ?? []).length, 3, "first paint, sub-replies, older replies");
  assert.match(read("public/styles.css"), /\.post-card\[data-folded\] > :not\(\.post-header\) \{ display: none; \}/);
  assert.doesNotMatch(read("public/js/reply-fold.js"), /localStorage|sessionStorage|api\(/);
});

// --- F3: back to the first post -------------------------------------------------------

test("first-post jump: long threads only, focuses the root card at click time", () => {
  const root = new FakeNode("article");
  root.scrollIntoView = () => {};
  assert.equal(createFirstPostJump(fakeDocument, root, LATEST_JUMP_MIN_REPLIES - 1), null);
  assert.equal(createFirstPostJump(fakeDocument, null, 10), null);
  const button = createFirstPostJump(fakeDocument, root, LATEST_JUMP_MIN_REPLIES);
  assert.equal(button.type, "button");
  assert.ok(button.textContent.length > 0);
  button.dispatch("click", { preventDefault() {} });
  assert.equal(root.ownerFocused, true);
  assert.match(read("public/js/routes/post.js"), /createFirstPostJump\(document, rootCard, post\.replies\.length\)/);
});

// --- i18n: every new key in all 21 locales -------------------------------------------

test("i18n: wave-12 keys exist and are translated in every locale", () => {
  const keys = ["post.foldReply", "post.foldReplyTitle", "post.firstPost"];
  const en = JSON.parse(read("public/locales/en.json"));
  const locales = ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant",
    "bg", "bn", "ca", "cs", "da", "el", "fa", "fi", "fil", "hr", "hu", "ms", "nb", "ro", "sk", "sr", "sv", "sw", "ta", "ur"];
  for (const key of keys) assert.equal(typeof en[key], "string", key);
  for (const code of locales) {
    const bundle = JSON.parse(read(`public/locales/${code}.json`));
    for (const key of keys) {
      assert.equal(typeof bundle[key], "string", `${code} ${key}`);
      assert.notEqual(bundle[key], en[key], `${code} ${key} is translated`);
    }
  }
});
