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

// Shared fake DOM for client-module tests. Its collections behave like the
// browser's, not like arrays: `.children` / getElementsBy* return a live
// HTMLCollection (indexed, length, item(), iterable — no forEach/map/find),
// `.childNodes` / querySelectorAll return a NodeList (adds forEach/entries/
// keys/values — still no map/find/filter). copy-link.js shipped in v4.9.0
// calling children.find and only a real browser caught it; this fake makes
// the suite catch that class of bug.

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const isElement = (node) => node?.nodeType === ELEMENT_NODE;

// A live, read-only, array-like view over whatever `read()` returns now.
const liveCollection = (read, kind) => {
  const base = {
    item: (index) => read()[index] ?? null,
    [Symbol.iterator]: () => read()[Symbol.iterator](),
    [Symbol.toStringTag]: kind,
  };
  if (kind === "NodeList") {
    base.forEach = (callback, thisArg) => read().forEach((node, i) => callback.call(thisArg, node, i, proxy));
    base.entries = () => read().entries();
    base.keys = () => read().keys();
    base.values = () => read().values();
  }
  if (kind === "HTMLCollection") {
    base.namedItem = (name) => read().find((node) => node.id === name || node.getAttribute?.("name") === name) ?? null;
  }
  const proxy = new Proxy(base, {
    get(target, key) {
      if (key === "length") return read().length;
      if (typeof key === "string" && /^\d+$/.test(key)) return read()[Number(key)];
      return target[key];
    },
    has(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) return Number(key) < read().length;
      return key === "length" || key in target;
    },
    set() { return false; },
  });
  return proxy;
};

// Minimal selector support: "tag", ".class", "tag.class", "[attr]", "[attr=v]"
// and comma lists — enough for the client modules, strict about the rest.
const matchesSimple = (node, selector) => {
  const match = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^\]"]*"|=[^\]"]*)?\])*)$/.exec(selector.trim());
  if (!match) throw new Error(`fake-dom: unsupported selector "${selector}"`);
  const [, tag, classes, attrs] = match;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  const own = String(node.className ?? "").split(/\s+/);
  for (const name of classes.split(".").filter(Boolean)) if (!own.includes(name)) return false;
  for (const [, name, quoted, bare] of attrs.matchAll(/\[([\w-]+)(?:="([^\]"]*)"|=([^\]"]*))?\]/g)) {
    const value = quoted ?? bare;
    if (!node.hasAttribute(name)) return false;
    if (value !== undefined && node.getAttribute(name) !== value) return false;
  }
  return true;
};
const matches = (node, selector) => selector.split(",").some((part) => matchesSimple(node, part));

export class FakeText {
  constructor(text) {
    this.nodeType = TEXT_NODE;
    this.textContent = String(text);
    this.parentNode = null;
  }
}

export class FakeNode {
  constructor(tagName) {
    this.nodeType = ELEMENT_NODE;
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.hidden = false;
    this.value = "";
    this.parentNode = null;
    this._nodes = [];
    this._text = "";
    this.children = liveCollection(() => this._nodes.filter(isElement), "HTMLCollection");
    this.childNodes = liveCollection(() => this._nodes, "NodeList");
  }
  get parentElement() { return isElement(this.parentNode) ? this.parentNode : null; }
  get firstChild() { return this._nodes[0] ?? null; }
  get lastChild() { return this._nodes.at(-1) ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { return this.children[this.children.length - 1] ?? null; }
  get childElementCount() { return this.children.length; }
  get textContent() {
    return this._nodes.length ? this._nodes.map((child) => child.textContent ?? "").join("") : this._text;
  }
  set textContent(value) { this._detachAll(); this._text = String(value ?? ""); }
  // A DOMTokenList over className (wave 5.25: the reply highlight).
  get classList() {
    const tokens = () => this.className.split(/\s+/).filter(Boolean);
    const write = (list) => { this.className = [...new Set(list)].join(" "); };
    return {
      add: (...names) => write([...tokens(), ...names]),
      remove: (...names) => write(tokens().filter((name) => !names.includes(name))),
      contains: (name) => tokens().includes(name),
      toggle: (name, force) => {
        const on = force ?? !tokens().includes(name);
        write(on ? [...tokens(), name] : tokens().filter((token) => token !== name));
        return on;
      },
    };
  }
  get id() { return this.attributes.id ?? ""; }
  set id(value) { this.attributes.id = String(value); }
  setAttribute(name, value) {
    if (name === "class") this.className = String(value);
    this.attributes[name] = String(value);
  }
  getAttribute(name) { return name === "class" ? this.className || null : this.attributes[name] ?? null; }
  hasAttribute(name) { return name === "class" ? Boolean(this.className) : name in this.attributes; }
  removeAttribute(name) {
    if (name === "class") this.className = "";
    delete this.attributes[name];
  }
  toggleAttribute(name, force) {
    const on = force ?? !this.hasAttribute(name);
    if (on) this.setAttribute(name, ""); else this.removeAttribute(name);
    return on;
  }
  _adopt(node) {
    const child = typeof node === "string" ? new FakeText(node) : node;
    if (child.parentNode?._nodes) child.parentNode._release(child);
    child.parentNode = this;
    return child;
  }
  _release(child) {
    this._nodes = this._nodes.filter((node) => node !== child);
    child.parentNode = null;
  }
  _detachAll() {
    for (const node of this._nodes) node.parentNode = null;
    this._nodes = [];
  }
  append(...nodes) {
    const adopted = nodes.map((node) => this._adopt(node));
    this._nodes = [...this._nodes, ...adopted];
  }
  prepend(...nodes) {
    const adopted = nodes.map((node) => this._adopt(node));
    this._nodes = [...adopted, ...this._nodes];
  }
  appendChild(node) { this.append(node); return node; }
  insertBefore(node, reference) {
    const child = this._adopt(node);
    const at = reference ? this._nodes.indexOf(reference) : -1;
    this._nodes = at < 0
      ? [...this._nodes, child]
      : [...this._nodes.slice(0, at), child, ...this._nodes.slice(at)];
    return node;
  }
  removeChild(node) { this._release(node); return node; }
  insertAdjacentElement(position, node) {
    if (position !== "afterend" || !this.parentNode) throw new Error(`fake-dom: insertAdjacentElement("${position}") unsupported`);
    const parent = this.parentNode;
    const at = parent._nodes.indexOf(this);
    parent.insertBefore(node, parent._nodes[at + 1] ?? null);
    return node;
  }
  replaceChildren(...nodes) {
    this._detachAll();
    this._text = "";
    this.append(...nodes);
  }
  remove() { this.parentNode?._release?.(this); }
  contains(node) {
    for (let cur = node; cur; cur = cur.parentNode) if (cur === this) return true;
    return false;
  }
  closest(selector) {
    for (let cur = this; isElement(cur); cur = cur.parentNode) if (matches(cur, selector)) return cur;
    return null;
  }
  matches(selector) { return matches(this, selector); }
  _descendants() {
    return this._nodes.filter(isElement).flatMap((child) => [child, ...child._descendants()]);
  }
  querySelectorAll(selector) {
    const hits = this._descendants().filter((node) => matches(node, selector));
    return liveCollection(() => hits, "NodeList");
  }
  querySelector(selector) { return this._descendants().find((node) => matches(node, selector)) ?? null; }
  getElementsByClassName(name) {
    return liveCollection(() => this._descendants().filter((node) => matchesSimple(node, `.${name}`)), "HTMLCollection");
  }
  getElementsByTagName(tag) {
    return liveCollection(() => this._descendants().filter((node) => tag === "*" || node.tagName === tag.toUpperCase()), "HTMLCollection");
  }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((fn) => fn !== listener);
  }
  // A caller-built event (one with its own preventDefault) is passed through
  // as-is so the caller can read back what the listener did to it.
  _event(event) {
    return typeof event.preventDefault === "function" ? event : { preventDefault() {}, target: this, ...event };
  }
  async fire(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) await listener(this._event(event));
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) listener(this._event(event));
  }
  focus() { this.ownerFocused = true; }
}

export const makeFakeDocument = (extra = {}) => ({
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (ns, tag) => new FakeNode(tag),
  createTextNode: (text) => new FakeText(text),
  ...extra,
});

export const findByClass = (node, name) => {
  if (String(node.className ?? "").split(" ").includes(name)) return node;
  for (const child of node.children ?? []) {
    const hit = findByClass(child, name);
    if (hit) return hit;
  }
  return null;
};

export const countByClass = (node, name) =>
  (String(node.className ?? "").split(" ").includes(name) ? 1 : 0)
  + Array.from(node.children ?? []).reduce((sum, child) => sum + countByClass(child, name), 0);
