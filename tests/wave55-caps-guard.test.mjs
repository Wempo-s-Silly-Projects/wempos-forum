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
// Wave 5.5 F1: caps guard — a quiet "that reads as shouting" note under the
// composer with a one-click sentence-case fix and an Undo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAPS_GUARD_MIN_LETTERS, CAPS_GUARD_RATIO, createCapsGuard, isShouting, toSentenceCase,
} from "../public/js/caps-guard.js";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

const makeField = (value = "") => {
  const field = new FakeNode("textarea");
  field.value = value;
  field.inputEvents = 0;
  field.dispatchEvent = (event) => { field.inputEvents += 1; field.dispatch(event.type, event); };
  return field;
};
const type = (field, value) => { field.value = value; field.dispatch("input"); };
const mount = (value = "") => {
  const field = makeField(value);
  const guard = createCapsGuard(field, makeFakeDocument());
  return { field, guard, fix: findByClass(guard, "caps-guard-fix"), undo: findByClass(guard, "caps-guard-undo") };
};

test("isShouting: mostly capitals over the minimum letter count", () => {
  assert.equal(CAPS_GUARD_RATIO, 0.7);
  assert.equal(CAPS_GUARD_MIN_LETTERS, 12);
  assert.equal(isShouting("WHY IS NOBODY ANSWERING MY QUESTION"), true);
  assert.equal(isShouting("WHY IS nobody answering"), false);
  assert.equal(isShouting("OK FINE"), false, "too few letters to judge");
  assert.equal(isShouting("I LOVE THIS FORUM SO MUCH!!! 100%"), true);
  assert.equal(isShouting(""), false);
  assert.equal(isShouting(null), false);
});

test("isShouting: scripts without letter case never trigger", () => {
  assert.equal(isShouting("这是一个很长的帖子内容我们在讨论论坛的功能"), false);
  assert.equal(isShouting("これはとても長い投稿ですよろしくお願いします"), false);
  assert.equal(isShouting("هذا منشور طويل جدا عن المنتدى والميزات"), false);
});

test("isShouting: links, code and mentions don't count as shouting", () => {
  assert.equal(isShouting("see https://EXAMPLE.COM/ABCDEFGHIJKLMNOP ok"), false);
  assert.equal(isShouting("run `SELECT COUNT FROM USERS WHERE ID` please"), false);
  assert.equal(isShouting("thanks @BIGLOUDNAMEHERE for this"), false);
});

test("toSentenceCase: lowers then capitalises each sentence start", () => {
  assert.equal(toSentenceCase("HELLO THERE. HOW ARE YOU? GREAT!"), "Hello there. How are you? Great!");
  assert.equal(toSentenceCase("FIRST LINE\nSECOND LINE"), "First line\nSecond line");
  assert.equal(toSentenceCase("I THINK I CAN"), "I think I can");
  assert.equal(toSentenceCase("ÉTÉ ÇA VA"), "Été ça va");
});

test("toSentenceCase: links, code and mentions stay byte-identical", () => {
  const input = "LOOK AT https://Example.com/AbC AND `MyFunc()` THANKS @BigBob. OK";
  assert.equal(toSentenceCase(input), "Look at https://Example.com/AbC and `MyFunc()` thanks @BigBob. Ok");
});

test("createCapsGuard: hidden until the text shouts, then offers the fix", () => {
  const { field, guard, fix } = mount();
  assert.equal(guard.hidden, true);
  assert.equal(guard.getAttribute("role"), "status");
  type(field, "THIS IS A VERY LOUD POST");
  assert.equal(guard.hidden, false);
  assert.equal(fix.hidden, false);
  type(field, "this is calm now");
  assert.equal(guard.hidden, true);
});

test("createCapsGuard: a restored loud draft shows the note on mount", () => {
  const { guard } = mount("RESTORED DRAFT THAT SHOUTS");
  assert.equal(guard.hidden, false);
});

test("Lower the caps rewrites the text, fires input once, and offers Undo", () => {
  const { field, guard, fix, undo } = mount();
  type(field, "THIS IS A VERY LOUD POST. PLEASE READ");
  const before = field.inputEvents;
  fix.dispatch("click");
  assert.equal(field.value, "This is a very loud post. Please read");
  assert.equal(field.inputEvents, before + 1, "draft autosave + counter hear the change");
  assert.equal(guard.hidden, false, "stays up to offer Undo");
  assert.equal(fix.hidden, true);
  assert.equal(undo.hidden, false);
  assert.equal(field.ownerFocused, true);
});

test("Undo puts the original back; typing again drops the Undo", () => {
  const { field, guard, fix, undo } = mount();
  type(field, "THIS IS A VERY LOUD POST");
  fix.dispatch("click");
  undo.dispatch("click");
  assert.equal(field.value, "THIS IS A VERY LOUD POST");
  assert.equal(fix.hidden, false);
  assert.equal(undo.hidden, true);
  fix.dispatch("click");
  type(field, "This is a very loud post, edited");
  assert.equal(undo.hidden, true);
  assert.equal(guard.hidden, true);
});

test("module is client-only and DOM-safe; composer mounts it under the textarea", () => {
  const module = read("public/js/caps-guard.js");
  assert.doesNotMatch(module, /innerHTML|localStorage|sessionStorage|\bapi\(|fetch\(/);
  const composer = read("public/js/routes/composer.js");
  assert.match(composer, /from "\.\.\/caps-guard\.js"/);
  assert.match(composer, /createCapsGuard\(bodyField, document\)/);
  assert.match(read("public/styles.css"), /\.caps-guard\b/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/caps-guard\.js">/);
});
