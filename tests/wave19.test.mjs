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

// Wave 2026-11-21-19. F1 hardening of the v4.21–v4.23 delta: the shared
// spoiler mask (server output paths since v4.22) must stay linear on
// marker-heavy bodies, and a masked excerpt must never split an emoji.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSpoilers, maskedExcerpt } from "../public/js/markdown.js";

const BODY_CAP = 4750; // MAX_COMPOSER_BODY_CHARS (api/posts-write.mjs)
// Linear work on a capped body is well under a millisecond or two; the
// quadratic scan this pins against took ~85 ms for these four bodies.
const MASK_BUDGET_MS = 30;

const fill = (unit) => ("||a|| " + unit.repeat(BODY_CAP)).slice(0, BODY_CAP);

test("maskSpoilers stays linear on marker-heavy capped bodies", () => {
  const bodies = ["*", "`", "[", "*`[~", "[](", "~"].map(fill);
  maskSpoilers(bodies[0]); // warm the JIT
  const started = performance.now();
  for (const body of bodies) maskSpoilers(body);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < MASK_BUDGET_MS, `masking took ${elapsed.toFixed(1)} ms`);
});

test("the memoized scan masks exactly what it did before", () => {
  const cases = [
    ["||unterminated", "||unterminated"],
    ["||a ||b|| c||", "▒▒▒b▒▒▒"],
    ["`||x||` ||y||", "`||x||` ▒▒▒"],
    // Bold/link/italic inner text is not re-parsed: it stays literal, as rendered.
    ["**||x||** [||l||](/p) *||e||*", "**||x||** [||l||](/p) *||e||*"],
    ["@a ||b|| ~~||c||~~", "@a ▒▒▒ ~~||c||~~"],
    ["[x] ( ||s|| )", "[x] ( ▒▒▒ )"],
  ];
  for (const [input, expected] of cases) assert.equal(maskSpoilers(input), expected, input);
});

test("maskedExcerpt never cuts a surrogate pair in half", () => {
  const out = maskedExcerpt("a".repeat(79) + "\u{1F600}x", 80);
  assert.equal(out, "a".repeat(79) + "…");
  assert.ok(out.isWellFormed());
  assert.equal(maskedExcerpt("\u{1F600}".repeat(50), 80), "\u{1F600}".repeat(40) + "…");
});

// F2: Ctrl+Enter / Cmd+Enter posts from the forum composers.
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { attachSubmitShortcut, isSubmitShortcut, SUBMIT_SHORTCUT_KEYS } from "../public/js/submit-shortcut.js";
import { createTextarea } from "../public/js/forms.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();
const keyEvent = (init) => {
  const event = { key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...init };
  event.prevented = false;
  event.preventDefault = () => { event.prevented = true; };
  return event;
};
const composerForm = () => {
  const form = new FakeNode("form");
  form.dataset.form = "post-reply";
  form.submits = 0;
  form.requestSubmit = () => { form.submits += 1; };
  const field = createTextarea(fakeDocument, {
    id: "reply-1-body", name: "body", label: "Reply", maxLength: 10, counter: true, submitShortcut: true,
  });
  form.append(field);
  return { form, textarea: field.querySelector("textarea") };
};

test("isSubmitShortcut accepts only Ctrl/Cmd+Enter outside IME composition", () => {
  assert.equal(isSubmitShortcut(keyEvent({ ctrlKey: true })), true);
  assert.equal(isSubmitShortcut(keyEvent({ metaKey: true })), true);
  assert.equal(isSubmitShortcut(keyEvent({})), false, "plain Enter is a newline");
  assert.equal(isSubmitShortcut(keyEvent({ shiftKey: true, ctrlKey: true })), false);
  assert.equal(isSubmitShortcut(keyEvent({ altKey: true, metaKey: true })), false);
  assert.equal(isSubmitShortcut(keyEvent({ ctrlKey: true, isComposing: true })), false, "IME candidate pick");
  assert.equal(isSubmitShortcut(keyEvent({ ctrlKey: true, key: "a" })), false);
  assert.equal(isSubmitShortcut(null), false);
});

test("the shortcut submits the composer's own form through requestSubmit", () => {
  const { form, textarea } = composerForm();
  assert.equal(textarea.getAttribute("aria-keyshortcuts"), SUBMIT_SHORTCUT_KEYS);
  const send = keyEvent({ metaKey: true });
  textarea.dispatch("keydown", send);
  assert.equal(form.submits, 1);
  assert.equal(send.prevented, true);
  const newline = keyEvent({});
  textarea.dispatch("keydown", newline);
  assert.equal(form.submits, 1, "plain Enter never submits");
  assert.equal(newline.prevented, false);
});

test("the shortcut does nothing while that form is already submitting", () => {
  const { form, textarea } = composerForm();
  form.dataset.submitting = "true";
  textarea.dispatch("keydown", keyEvent({ ctrlKey: true }));
  assert.equal(form.submits, 0);
});

test("the shortcut hint is a muted, translated line under the composer", () => {
  const { form } = composerForm();
  const hint = findByClass(form, "composer-shortcut");
  assert.ok(hint);
  assert.equal(hint.textContent, t("composer.sendShortcut"));
  const plain = createTextarea(fakeDocument, { id: "x", label: "X", maxLength: 10, counter: true });
  assert.equal(findByClass(plain, "composer-shortcut"), null, "opt-in only");
  assert.equal(attachSubmitShortcut(fakeDocument, new FakeNode("textarea")).className.includes("composer-shortcut"), true);
});

test("post, reply, edit and wall composers opt in; locales carry the hint", () => {
  for (const path of ["public/js/routes/composer.js", "public/js/render.js", "public/js/wall.js"]) {
    assert.match(read(path), /submitShortcut: true/, path);
  }
  assert.match(read("public/styles.css"), /\.composer-shortcut/);
  for (const locale of ["en", "de", "ja", "ar", "zh-Hans"]) {
    const bundle = JSON.parse(read(`public/locales/${locale}.json`));
    assert.equal(typeof bundle["composer.sendShortcut"], "string", locale);
  }
});
