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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import {
  COMPOSER_ACCEPT, MAX_COMPOSER_FILE_BYTES, addComposerFiles, isComposerImageType,
} from "../public/js/attachments.js";
import {
  attachPasteAndDrop, confirmPendingFiles, dismissPendingFiles,
} from "../public/js/composer-paste.js";
import {
  COMPOSER_MAX_CHARS, counterBand, nearLimitThreshold,
} from "../public/js/composer-limits.js";
import { createTextarea } from "../public/js/forms.js";
import { createEditComposer, editHasUnsavedChanges } from "../public/js/render.js";
import { MAX_COMPOSER_BODY_CHARS } from "../api/posts-write.mjs";
import { LOCALES } from "../public/js/i18n.js";

// fake-dom does not mirror dataset into [data-*] selectors, so walk it.
const byData = (root, key, value) => {
  for (const child of [...root.children]) {
    if (child.dataset[key] !== undefined && (value === undefined || child.dataset[key] === value)) return child;
    const hit = byData(child, key, value);
    if (hit) return hit;
  }
  return null;
};
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const png = (name = "image.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], "notes.pdf", { type: "application/pdf" });
const NEW_KEYS = [
  "attachments.wrongType", "composer.pendingImages.one", "composer.pendingImages.other",
  "composer.pendingAttach", "composer.pendingDismiss", "render.discardEditConfirm",
];

// --- Upload path reuse: type + size + count rejection all live in addComposerFiles.

test("addComposerFiles refuses a non-image type with a notice and keeps the rest", () => {
  const { files, notices } = addComposerFiles([], [pdf(), png()]);
  assert.deepEqual(files.map((file) => file.name), ["image.png"]);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /wrongType|notes\.pdf/);
});

test("addComposerFiles still refuses oversize files and a fourth file", () => {
  const big = { name: "big.png", type: "image/png", size: MAX_COMPOSER_FILE_BYTES + 1 };
  assert.equal(addComposerFiles([], [big]).files.length, 0);
  const three = [png("a.png"), png("b.png"), png("c.png")];
  const { files, notices } = addComposerFiles(three, [png("d.png")]);
  assert.equal(files.length, 3);
  assert.equal(notices.length, 1);
});

test("isComposerImageType mirrors COMPOSER_ACCEPT exactly", () => {
  for (const type of COMPOSER_ACCEPT.split(",")) assert.equal(isComposerImageType({ type }), true, type);
  for (const type of ["", "image/svg+xml", "image/heic", "text/plain", undefined]) {
    assert.equal(isComposerImageType({ type }), false, String(type));
  }
  assert.equal(isComposerImageType(null), false);
});

// --- Paste / drop staging: pending until the member confirms; nothing uploads.

const composerFixture = () => {
  const document = makeFakeDocument();
  const form = new FakeNode("form");
  const textarea = new FakeNode("textarea");
  form.append(textarea);
  const notices = [];
  const strip = attachPasteAndDrop(form, textarea, document, (list) => notices.push(...list));
  form.append(strip);
  return { form, textarea, strip, notices };
};

const transferOf = (files, types = ["Files"]) => ({ files, types });

test("pasting an image stages it as pending; nothing is attached until confirm", () => {
  const { form, textarea, strip } = composerFixture();
  let prevented = false;
  textarea.dispatch("paste", { clipboardData: transferOf([png()]), preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(strip.hidden, false);
  assert.equal(form.pendingComposerFiles.length, 1);
  assert.equal(form.composerFiles, undefined, "not attached yet");
  assert.ok(byData(strip, "action", "attach-pending-files"));
  assert.ok(byData(strip, "action", "dismiss-pending-files"));
  assert.equal(strip.querySelector(".composer-pending-note").getAttribute("aria-live"), "polite");
});

test("pasting text (even alongside a file) is left to the browser", () => {
  const { form, textarea, strip } = composerFixture();
  let prevented = false;
  textarea.dispatch("paste", {
    clipboardData: transferOf([png()], ["text/plain", "Files"]), preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false);
  assert.equal(strip.hidden, true);
  assert.equal(form.pendingComposerFiles, undefined);
});

test("pasting only a non-image reports the type notice and stages nothing", () => {
  const { form, textarea, strip, notices } = composerFixture();
  textarea.dispatch("paste", { clipboardData: transferOf([pdf()]) });
  assert.equal(strip.hidden, true);
  assert.equal((form.pendingComposerFiles ?? []).length, 0);
  assert.equal(notices.length, 1);
});

test("dragging files over the composer allows a drop; the drop stages them", () => {
  const { form, strip } = composerFixture();
  let overPrevented = false;
  form.dispatch("dragover", { dataTransfer: transferOf([]), preventDefault() { overPrevented = true; } });
  assert.equal(overPrevented, true);
  assert.match(form.className, /composer-drop-target/);
  let dropPrevented = false;
  form.dispatch("drop", { dataTransfer: transferOf([png(), png("two.png")]), preventDefault() { dropPrevented = true; } });
  assert.equal(dropPrevented, true);
  assert.doesNotMatch(form.className, /composer-drop-target/);
  assert.equal(form.pendingComposerFiles.length, 2);
  assert.equal(strip.hidden, false);
});

test("a text drag is not intercepted", () => {
  const { form } = composerFixture();
  let prevented = false;
  form.dispatch("dragover", { dataTransfer: transferOf([], ["text/plain"]), preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

test("confirm folds pending files through the shared caps; dismiss drops them", () => {
  const { form, textarea, strip } = composerFixture();
  form.composerFiles = [png("a.png"), png("b.png")];
  textarea.dispatch("paste", { clipboardData: transferOf([png("c.png"), png("d.png")]) });
  assert.equal(form.pendingComposerFiles.length, 1, "the staging preview already applies the 3-file cap");
  const notices = confirmPendingFiles(form);
  assert.deepEqual(form.composerFiles.map((file) => file.name), ["a.png", "b.png", "c.png"]);
  assert.deepEqual(notices, []);
  assert.equal(strip.hidden, true);
  assert.equal(form.pendingComposerFiles.length, 0);

  textarea.dispatch("paste", { clipboardData: transferOf([png("e.png")]) });
  dismissPendingFiles(form);
  assert.equal(form.composerFiles.length, 3, "dismiss never touches attached files");
  assert.equal(strip.hidden, true);
});

test("composer-paste stays local: no network, storage or markup sinks", () => {
  assert.doesNotMatch(read("public/js/composer-paste.js"),
    /localStorage|sessionStorage|\bapi\(|fetch\(|innerHTML|FormData/);
});

test("post/reply composers wire paste+drop and the confirm/dismiss actions", () => {
  const composer = read("public/js/routes/composer.js");
  assert.match(composer, /from "\.\.\/composer-paste\.js"/);
  assert.match(composer, /attachPasteAndDrop\(form, bodyField, document,/);
  assert.match(composer, /"attach-pending-files":/);
  assert.match(composer, /"dismiss-pending-files":/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/composer-paste\.js">/);
  assert.match(read("public/styles.css"), /\.composer-pending\s*\{/);
});

// --- Counter: the same server cap, announced politely only near the limit.

test("the client body cap is the server's body cap", () => {
  assert.equal(COMPOSER_MAX_CHARS, MAX_COMPOSER_BODY_CHARS);
});

test("counterBand: ok, near (last 10%), full", () => {
  assert.equal(nearLimitThreshold(4750), 475);
  assert.equal(counterBand(4750, ""), "ok");
  assert.equal(counterBand(4750, "x".repeat(4750 - 476)), "ok");
  assert.equal(counterBand(4750, "x".repeat(4750 - 475)), "near");
  assert.equal(counterBand(4750, "x".repeat(4750)), "full");
  assert.equal(counterBand(4750, null), "ok");
});

test("the counter is quiet per keystroke and announces once per band change", () => {
  const document = makeFakeDocument();
  const wrapper = createTextarea(document, { id: "c", label: "Body", maxLength: 100, counter: true });
  const textarea = wrapper.querySelector("textarea");
  const counter = wrapper.querySelector(".char-counter");
  const announcer = byData(wrapper, "charAnnouncer");
  assert.equal(counter.getAttribute("aria-live"), null, "the visible count is not a live region");
  assert.equal(announcer.getAttribute("role"), "status");
  assert.equal(announcer.textContent, "");
  const type = (value) => { textarea.value = value; textarea.dispatch("input"); };
  type("x".repeat(50));
  assert.equal(announcer.textContent, "", "far from the cap: silent");
  type("x".repeat(91));
  const nearText = announcer.textContent;
  assert.ok(nearText, "crossing into the last 10% announces");
  assert.match(counter.className, /char-counter-near/);
  type("x".repeat(95));
  assert.equal(announcer.textContent, nearText, "no re-announce inside the band");
  // t() returns the bare key without a loaded table, so mark the slot and
  // check that reaching the cap rewrites it (live: "0 chars left").
  announcer.textContent = "";
  type("x".repeat(100));
  assert.ok(announcer.textContent, "hitting the cap announces again");
  type("x".repeat(10));
  assert.equal(announcer.textContent, "");
  assert.equal(counter.className, "char-counter");
});

test("a prefilled near-limit body paints the near style without announcing", () => {
  const wrapper = createTextarea(makeFakeDocument(), {
    id: "p", label: "Body", maxLength: 100, counter: true, value: "x".repeat(95),
  });
  assert.match(wrapper.querySelector(".char-counter").className, /char-counter-near/);
  assert.equal(byData(wrapper, "charAnnouncer").textContent, "");
});

// --- Edit composer: Cancel asks before throwing away changed text.

test("editHasUnsavedChanges compares the edit textarea with the post body", () => {
  const document = makeFakeDocument();
  const article = new FakeNode("article");
  article.postBody = "hello";
  assert.equal(editHasUnsavedChanges(article), false, "no open edit form");
  const form = createEditComposer({ id: 7, body: "hello" }, document);
  article.append(form);
  assert.equal(editHasUnsavedChanges(article), false);
  form.querySelector("textarea").value = "hello there";
  assert.equal(editHasUnsavedChanges(article), true);
  assert.equal(editHasUnsavedChanges(null), false);
});

test("cancel-edit confirms only when the edit has unsaved changes", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post,
    /"cancel-edit":[\s\S]{0,200}editHasUnsavedChanges\(article\) && !window\.confirm\(t\("render\.discardEditConfirm"\)\)\) return;[\s\S]{0,80}closeEditForm\(article\)/);
});

test("new strings exist in en and are translated in all 20 locales", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of NEW_KEYS) assert.equal(typeof en[key], "string", key);
  const others = LOCALES.map((locale) => locale.code).filter((code) => code !== "en");
  assert.equal(others.length, 44);
  for (const code of others) {
    const bag = JSON.parse(read(`public/locales/${code}.json`));
    for (const key of NEW_KEYS) {
      assert.equal(typeof bag[key], "string", `${code} ${key}`);
      assert.notEqual(bag[key], en[key], `${code} ${key} is translated`);
    }
  }
});
