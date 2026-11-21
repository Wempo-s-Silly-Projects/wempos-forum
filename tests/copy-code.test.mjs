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

// Copy code (wave 2026-11-21-10 F3): the button copies the fenced block's raw
// text, announces success/failure in a polite status beside it, and rides
// every fenced code block renderBodyBlocks paints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyText, createCopyCodeButton } from "../public/js/copy-code.js";
import { renderBodyBlocks } from "../public/js/render.js";
import { t } from "../public/js/i18n.js";
import { makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";

const fakeDocument = makeFakeDocument();
const locale = (code) => JSON.parse(readFileSync(new URL(`../public/locales/${code}.json`, import.meta.url), "utf8"));

test("copyText resolves true on a write, false on refusal or a missing clipboard", async () => {
  const written = [];
  assert.equal(await copyText({ writeText: async (text) => { written.push(text); } }, "a\n  b"), true);
  assert.deepEqual(written, ["a\n  b"], "whitespace and newlines survive verbatim");
  assert.equal(await copyText({ writeText: async () => { throw new Error("denied"); } }, "x"), false);
  assert.equal(await copyText(null, "x"), false);
  assert.equal(await copyText({}, "x"), false);
});

test("the copy button copies the text at click time and announces it, then clears", async () => {
  const written = [];
  const timers = [];
  let current = "first";
  const tools = createCopyCodeButton(fakeDocument, () => current, {
    clipboard: { writeText: async (text) => { written.push(text); } },
    schedule: (fn, ms) => timers.push([fn, ms]),
  });
  const button = findByClass(tools, "copy-code");
  const status = findByClass(tools, "copy-code-status");
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-label"), t("render.copyCode"));
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.textContent, "", "mounted empty so the change is announced");
  assert.ok(!Array.from(button.children).includes(status), "status sits beside the labelled button");
  current = "second";
  await button.fire("click");
  assert.deepEqual(written, ["second"]);
  assert.equal(status.textContent, t("render.codeCopied"));
  assert.equal(button.dataset.copied, "true");
  assert.equal(timers[0][1], 2000);
  timers[0][0]();
  assert.equal(status.textContent, "");
});

test("a refused clipboard shows the failure status instead", async () => {
  const tools = createCopyCodeButton(fakeDocument, () => "x", {
    clipboard: { writeText: async () => { throw new Error("no secure context"); } },
    schedule: () => {},
  });
  await findByClass(tools, "copy-code").fire("click");
  assert.equal(findByClass(tools, "copy-code-status").textContent, t("render.copyCodeFailed"));
  assert.equal(findByClass(tools, "copy-code").dataset.copied, "false");
});

test("renderBodyBlocks gives every fenced code block a copy button; the code text is untouched", () => {
  const article = fakeDocument.createElement("article");
  renderBodyBlocks({ body: "hi\n```\nconst a = 1;\n  return a;\n```\nbye" }, fakeDocument, article);
  const pre = findByClass(article, "post-codeblock");
  assert.ok(pre, "the pre stays a direct block of the card (edit swap hides it by class)");
  assert.ok(Array.from(article.children).includes(pre));
  assert.ok(findByClass(pre, "copy-code"));
  const code = Array.from(pre.children).find((node) => node.tagName?.toLowerCase() === "code");
  assert.equal(code.textContent, "const a = 1;\n  return a;");
});

test("copy-code strings ship in English and are translated in every locale", () => {
  const en = locale("en");
  for (const key of ["render.copyCode", "render.codeCopied", "render.copyCodeFailed"]) assert.ok(en[key]);
  for (const code of ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant",
    "bg", "bn", "ca", "cs", "da", "el", "fa", "fi", "fil", "hr", "hu", "ms", "nb", "ro", "sk", "sr", "sv", "sw", "ta", "ur"]) {
    assert.notEqual(locale(code)["render.copyCode"], en["render.copyCode"], `${code} is translated`);
  }
});
