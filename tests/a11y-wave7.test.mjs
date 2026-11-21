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

// Wave 2026-11-21-7 F1: code-level accessibility pass over the UI shipped in
// waves 1-6 tonight (focus kept across repaints, focus moved on jumps, live
// regions mounted before they speak, reduced motion honored, names/roles).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  focusSelector, jumpToNode, prefersReducedMotion, restoreFocus,
} from "../public/js/focus-utils.js";
import { createCopyLinkButton } from "../public/js/copy-link.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.className = "";
    this._text = "";
  }
  get textContent() {
    return this.children.length ? this.children.map((child) => child.textContent ?? "").join("") : this._text;
  }
  set textContent(value) { this.children = []; this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  async fire(type) {
    for (const listener of this.listeners[type] ?? []) await listener({ preventDefault() {} });
  }
}
const fakeDocument = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (ns, tag) => new FakeNode(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
};
const findByClass = (node, name) => {
  if (node.className?.split?.(" ").includes(name)) return node;
  for (const child of node.children ?? []) {
    const hit = findByClass(child, name);
    if (hit) return hit;
  }
  return null;
};

// --- focus helpers -----------------------------------------------------------------

test("focusSelector records the focused control inside the root, with its caret", () => {
  const active = { className: "button chat-widget-group-add-input", selectionStart: 2, selectionEnd: 4 };
  const root = { contains: (node) => node === active };
  assert.deepEqual(focusSelector(root, active),
    { selector: ".chat-widget-group-add-input", start: 2, end: 4 });
  assert.equal(focusSelector(root, { className: "elsewhere" }), null, "focus outside the root is ignored");
  assert.equal(focusSelector(root, root), null);
  assert.equal(focusSelector(null, active), null);
});

test("restoreFocus re-focuses the matching control and its caret; disabled or gone is a no-op", () => {
  const calls = [];
  const target = {
    disabled: false,
    focus: () => calls.push("focus"),
    setSelectionRange: (start, end) => calls.push(["range", start, end]),
  };
  const root = { querySelector: (selector) => (selector === ".chat-widget-pin" ? target : null) };
  restoreFocus(root, { selector: ".chat-widget-pin", start: 1, end: 1 });
  assert.deepEqual(calls, ["focus", ["range", 1, 1]]);
  restoreFocus(root, { selector: ".gone" });
  restoreFocus(root, null);
  target.disabled = true;
  restoreFocus(root, { selector: ".chat-widget-pin" });
  assert.equal(calls.length, 2);
});

test("jumpToNode makes the target focusable, focuses it, and drops smooth scroll under reduced motion", () => {
  const scrolls = [];
  const focuses = [];
  const node = new FakeNode("article");
  node.scrollIntoView = (options) => scrolls.push(options);
  node.focus = (options) => focuses.push(options);
  jumpToNode(node, { block: "center", reducedMotion: true });
  assert.equal(node.getAttribute("tabindex"), "-1");
  assert.equal(scrolls[0].behavior, "auto");
  assert.equal(scrolls[0].block, "center");
  assert.deepEqual(focuses[0], { preventScroll: true });
  jumpToNode(node, { reducedMotion: false });
  assert.equal(scrolls[1].behavior, "smooth");
  jumpToNode(null);
});

test("prefersReducedMotion reads the media query and is false without matchMedia", () => {
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(prefersReducedMotion({}), false);
});

// --- copy link: the status works and is mounted before it speaks -------------------

test("copy-link mounts an empty polite status beside the button and never relies on Array methods of children", async () => {
  const timers = [];
  const wrap = createCopyLinkButton(fakeDocument, 5, {
    origin: "https://wempos-forum.com",
    clipboard: { writeText: async () => {} },
    schedule: (fn, ms) => timers.push(fn),
  });
  const button = findByClass(wrap, "copy-link");
  const status = findByClass(wrap, "copy-link-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.textContent, "", "mounted empty before any click");
  assert.ok(!button.children.includes(status), "the status is not inside the labelled button");
  await button.fire("click");
  assert.ok(status.textContent.length > 0);
  timers[0]();
  assert.equal(status.textContent, "");
  assert.doesNotMatch(read("public/js/copy-link.js"), /children\.(find|filter)\(/,
    "HTMLCollection has no find/filter — that threw in real browsers");
});

// --- chat widget ----------------------------------------------------------------------

test("chat conversation repaints keep the focused control (pin toggle, add-member input, remove)", () => {
  const source = read("public/js/chat-widget-composer.js");
  assert.match(source, /from "\.\/focus-utils\.js"/);
  assert.match(source, /focusSelector\(ui\.conversationEl, document\.activeElement\)/);
  assert.match(source, /restoreFocus\(ui\.conversationEl, keptFocus\)/);
});

test("chat filter announces an empty result through a status mounted outside the rows", () => {
  const threads = read("public/js/chat-widget-threads.js");
  assert.match(threads, /ui\.filterStatusEl = /);
  assert.match(threads, /setAttribute\("role", "status"\)/);
  assert.match(threads, /ui\.filterStatusEl\.textContent = /);
});

test("chat panel: Escape closes, focus moves in on open and back to the launcher on close; tabs are toggles", () => {
  const widget = read("public/js/chat-widget.js");
  assert.match(widget, /event\.key !== "Escape" \|\| event\.defaultPrevented/);
  assert.match(widget, /launcher\.focus\(\)/);
  assert.doesNotMatch(widget, /aria-selected/, "aria-selected is not valid on plain buttons");
  assert.match(widget, /setAttribute\("aria-pressed", String\(showLobby\)\)/);
});

test("chat GIF images carry a translated alt", () => {
  const gifs = read("public/js/chat-widget-gifs.js");
  assert.doesNotMatch(gifs, /img\.alt = "GIF"/);
  assert.match(gifs, /img\.alt = t\("chat\.gifAlt"\)/);
});

// --- forum reader surfaces ----------------------------------------------------------

test("catch-up divider text is readable and the jump moves focus without forced smooth scroll", () => {
  const source = read("public/js/catch-up.js");
  assert.doesNotMatch(source, /"separator"/, "separator children are presentational, the words were lost");
  assert.match(source, /jumpToNode\(/);
  assert.doesNotMatch(source, /behavior: "smooth"/);
});

test("glance strip is a labelled group and its top-reply jump moves focus", () => {
  const source = read("public/js/thread-glance.js");
  assert.match(source, /strip\.setAttribute\("role", "group"\)/);
  assert.match(source, /jumpToNode\(card/);
  assert.doesNotMatch(source, /behavior: "smooth"/);
});
