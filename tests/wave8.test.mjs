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

// Wave 2026-11-21-8: F1 realistic fake-DOM collections (real browser bugs the
// array-backed fakes hid), F2 accessibility LOWs, F3 forum-side unique.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { closeEditForm, openEditForm } from "../public/js/render.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();
const el = (tag, className) => Object.assign(new FakeNode(tag), { className });

// --- F1: the fake behaves like the browser ------------------------------------

test("fake DOM collections are array-like, not arrays (HTMLCollection / NodeList shapes)", () => {
  const root = el("div", "root");
  root.append(el("p", "a"), el("p", "b"));
  assert.equal(Array.isArray(root.children), false);
  assert.equal(root.children.length, 2);
  assert.equal(root.children[1].className, "b");
  assert.equal(typeof root.children.find, "undefined", "HTMLCollection has no find");
  assert.equal(typeof root.children.forEach, "undefined", "HTMLCollection has no forEach");
  const list = root.querySelectorAll("p");
  assert.equal(typeof list.forEach, "function", "NodeList has forEach");
  assert.equal(typeof list.map, "undefined", "NodeList has no map");
  assert.equal(typeof list.filter, "undefined", "NodeList has no filter");
  assert.deepEqual([...root.children].map((node) => node.className), ["a", "b"]);
});

test("BUG(render.js:570): editing a post hides its markdown lists along with the other body blocks", () => {
  const article = el("article", "post-card");
  article.dataset.postId = "9";
  article.postBody = "intro\n\n- one\n- two";
  const body = el("p", "post-body");
  const list = el("ul", "md-list");
  list.append(el("li", "md-list-item"));
  const actions = el("div", "post-actions");
  article.append(body, list, actions);

  assert.equal(openEditForm(article, fakeDocument), true);
  assert.equal(body.hidden, true);
  assert.equal(list.hidden, true, "the list stayed visible under the edit form");
  assert.equal(actions.hidden, false, "the action row is not a body block");

  assert.equal(closeEditForm(article), true);
  assert.equal(list.hidden, false, "cancel restores the list");
});
