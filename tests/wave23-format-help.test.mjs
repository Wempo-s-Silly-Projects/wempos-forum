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

// Wave 2026-11-21-23 F2: the composer's Formatting help. Every row it lists
// must be markup the renderer really honours, so the help can never promise
// a format the post page ignores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FORMAT_ROWS, createFormatHelp } from "../public/js/format-help.js";
import { createTextarea } from "../public/js/forms.js";
import { parseBlocks, parseInline } from "../public/js/markdown.js";
import { t, LOCALES } from "../public/js/i18n.js";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";

const doc = makeFakeDocument();
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const sample = (syntax) => syntax.replaceAll("…", "x");

const INLINE = {
  "format.bold": "STRONG", "format.italic": "EM", "format.strike": "DEL", "format.code": "CODE",
  "format.spoiler": "SPAN", "format.link": "A", "format.mention": "A",
};
const BLOCK = { "format.list": "list", "format.quote": "quote", "format.heading": "heading" };

test("every inline row renders as the element it names", () => {
  for (const [syntax, key] of FORMAT_ROWS.filter(([, key]) => key in INLINE)) {
    const nodes = parseInline(doc, sample(syntax));
    assert.equal(nodes.length, 1, syntax);
    assert.equal(nodes[0].tagName, INLINE[key], syntax);
  }
  const [mention] = parseInline(doc, sample("@…"));
  assert.equal(mention.className, "mention");
  const [spoiler] = parseInline(doc, sample("||…||"));
  assert.match(spoiler.className, /\bspoiler\b/);
});

test("every line-start row and the fence render as their block", () => {
  for (const [syntax, key] of FORMAT_ROWS.filter(([, key]) => key in BLOCK)) {
    assert.equal(parseBlocks(sample(syntax))[0].kind, BLOCK[key], syntax);
  }
  const fence = FORMAT_ROWS.find(([, key]) => key === "format.codeBlock")[0];
  assert.equal(parseBlocks(`${fence}\nx\n${fence}`)[0].kind, "code");
  const covered = new Set([...Object.keys(INLINE), ...Object.keys(BLOCK), "format.codeBlock"]);
  assert.deepEqual(FORMAT_ROWS.map(([, key]) => key).filter((key) => !covered.has(key)), []);
});

test("the disclosure starts closed and lists one term per row", () => {
  const help = createFormatHelp(doc);
  assert.equal(help.tagName, "DETAILS");
  assert.ok(!help.open);
  assert.equal(help.querySelector("summary").textContent, t("format.summary"));
  const terms = help.querySelectorAll("dt");
  const meanings = help.querySelectorAll("dd");
  assert.equal(terms.length, FORMAT_ROWS.length);
  assert.equal(meanings.length, FORMAT_ROWS.length);
  FORMAT_ROWS.forEach(([syntax, key], i) => {
    assert.equal(terms[i].textContent, syntax);
    assert.equal(terms[i].querySelector("code").textContent, syntax);
    assert.equal(meanings[i].textContent, t(key));
  });
  assert.equal(help.querySelector("p").textContent, t("format.note"));
});

test("createTextarea adds the help only when asked", () => {
  const base = { id: "b", label: "Body", maxLength: 10 };
  assert.equal(createTextarea(doc, base).querySelector("details"), null);
  assert.ok(createTextarea(doc, { ...base, formatHelp: true }).querySelector("details.format-help"));
});

test("the forum composers opt in; the inline-only wall does not", () => {
  assert.match(read("public/js/render.js"), /submitShortcut: true, formatHelp: true/);
  assert.match(read("public/js/routes/composer.js"), /submitShortcut: true, formatHelp: true/);
  assert.doesNotMatch(read("public/js/wall.js"), /formatHelp/);
});

test("format strings exist in en and every locale, translated", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  const keys = ["format.summary", "format.note", ...FORMAT_ROWS.map(([, key]) => key)];
  for (const code of LOCALES.map((entry) => entry.code)) {
    const messages = JSON.parse(read(`public/locales/${code}.json`));
    for (const key of keys) {
      assert.equal(typeof messages[key], "string", `${code} ${key}`);
      if (code !== "en") assert.notEqual(messages[key], en[key], `${code} ${key} is English`);
    }
  }
});
