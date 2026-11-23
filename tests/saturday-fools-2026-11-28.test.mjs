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

// Saturday Fools 2026-11-28 "Yell Saturday" (April Fools version). Stripped
// with its module on Sunday 2026-11-29 (docs/saturday-fools.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import yell, { YELL_LABEL_VAR, YELL_ROOT_CLASS } from "../public/js/fun/saturday-fools/2026-11-28-yell.js";
import { GAGS } from "../public/js/fun/saturday-fools/index.js";
import { gagForDate, gagRunner } from "../public/js/fun/saturday-fools.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const KEYS = ["fools.20261128.name", "fools.20261128.yell"];

function page() {
  const html = new FakeNode("html");
  const props = {};
  html.style = { props, setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } };
  const body = new FakeNode("body");
  html.append(body);
  const form = (name, label) => {
    const node = new FakeNode("form");
    node.setAttribute("data-form", name);
    const button = new FakeNode("button");
    button.setAttribute("type", "submit");
    button.type = "submit";
    button.textContent = label;
    node.append(button);
    body.append(node);
    return { form: node, button };
  };
  const doc = makeFakeDocument({
    documentElement: html, body,
    querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s),
  });
  return { doc, html, props, form };
}

test("it is the gag for Saturday 2026-11-28 only", () => {
  assert.ok(GAGS.includes(yell));
  assert.equal(yell.date, "2026-11-28");
  assert.equal(gagForDate(GAGS, new Date(2026, 10, 28, 9)), yell);
  assert.equal(gagForDate(GAGS, new Date(2026, 10, 29, 9)), null);
  assert.equal(gagForDate(GAGS, new Date(2026, 11, 5, 9)), null);
});

test("the Post/Reply buttons keep their accessible name and real text; other forms are untouched", () => {
  const { doc, html, props, form } = page();
  const post = form("post-create", "Start conversation");
  const reply = form("reply", "Reply");
  const ban = form("admin-ban", "Ban");
  const undo = yell.apply(doc);
  assert.ok(html.classList.contains(YELL_ROOT_CLASS));
  assert.match(props[YELL_LABEL_VAR], /^".+"$/, "the word reaches CSS as a quoted string via the CSSOM");
  assert.equal(post.button.getAttribute("aria-label"), "Start conversation");
  assert.equal(reply.button.getAttribute("aria-label"), "Reply");
  assert.equal(post.button.textContent, "Start conversation", "the DOM label is unchanged");
  assert.equal(post.button.type, "submit", "still a working submit button");
  assert.equal(ban.button.hasAttribute("aria-label"), false, "moderation forms are not touched");
  undo();
  assert.equal(html.classList.contains(YELL_ROOT_CLASS), false);
  assert.equal(props[YELL_LABEL_VAR], undefined);
  assert.equal(post.button.hasAttribute("aria-label"), false);
  assert.equal(reply.button.hasAttribute("aria-label"), false);
});

test("an author's own aria-label is kept through apply and undo", () => {
  const { doc, form } = page();
  const post = form("post-create", "Post");
  post.button.setAttribute("aria-label", "Publish your post");
  const undo = yell.apply(doc);
  assert.equal(post.button.getAttribute("aria-label"), "Publish your post");
  undo();
  assert.equal(post.button.getAttribute("aria-label"), "Publish your post");
});

test("reduced motion: the gag is static, so it runs unchanged (no motion anywhere)", () => {
  assert.equal(yell.motion, false);
  assert.equal(gagRunner(yell, true), yell.apply);
});

test("enhance pins composers rendered after apply, and no listener is ever added", () => {
  const { doc, html, form } = page();
  yell.apply(doc);
  const late = form("reply", "Reply");
  yell.enhance(html);
  assert.equal(late.button.getAttribute("aria-label"), "Reply");
  assert.deepEqual(late.form.listeners, {});
  assert.deepEqual(late.button.listeners, {});
});

test("its strings exist in every locale", () => {
  const dir = new URL("public/locales/", ROOT);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const table = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    for (const key of KEYS) assert.ok(typeof table[key] === "string" && table[key].trim(), `${file} ${key}`);
  }
  assert.equal(yell.name, KEYS[0]);
});

test("its CSS is one delimited block in styles.css, with no motion", () => {
  const css = read("public/styles.css");
  const start = "/* saturday-fools:2026-11-28 start */";
  const end = "/* saturday-fools:2026-11-28 end */";
  assert.equal(css.split(start).length, 2);
  assert.equal(css.split(end).length, 2);
  const block = css.slice(css.indexOf(start), css.indexOf(end));
  const outside = css.replace(block, "");
  assert.doesNotMatch(outside, /fools-2026-11-28/, "nothing of this gag lives outside its block");
  assert.doesNotMatch(block, /transition|animation|@keyframes/);
  assert.match(block, /content: var\(--fools-2026-11-28-yell, "!"\) \/ ""/, "generated text is hidden from the accessible name");
  assert.match(block, /@supports \(content: "x" \/ ""\)/);
});
