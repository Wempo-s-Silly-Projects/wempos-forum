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

// Batch H: a tiny, tolerant HTML parser for node tests that need a DOM-shaped
// tree (the vendored turndown runs on it through a fake window.DOMParser).
// It knows elements, text, comments, void tags and raw-text script/style; it
// never executes anything. Only the node API turndown touches is modelled.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const decode = (text) => text.replace(/&(#?\w+);/g, (whole, name) => {
  if (ENTITIES[name] !== undefined) return ENTITIES[name];
  if (/^#\d+$/.test(name)) return String.fromCodePoint(Number(name.slice(1)));
  return whole;
});

class MiniNode {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.parentNode = null;
    this.childNodes = [];
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get previousSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    const at = siblings.indexOf(this);
    return at > 0 ? siblings[at - 1] : null;
  }
  get textContent() {
    if (this.nodeType === 3) return this.data;
    if (this.nodeType === 8) return "";
    return this.childNodes.map((node) => node.textContent).join("");
  }
  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
  getElementsByTagName(name) {
    const wanted = String(name).toUpperCase();
    const found = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1 && (wanted === "*" || child.nodeName === wanted)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  getElementById(id) {
    return this.getElementsByTagName("*").find((node) => node.getAttribute("id") === id) ?? null;
  }
}

class MiniElement extends MiniNode {
  constructor(tag, attributes) {
    super(1, tag.toUpperCase());
    this.tagName = this.nodeName;
    this.attributes = attributes;
  }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  get outerHTML() {
    const tag = this.nodeName.toLowerCase();
    return "<" + tag + ">" + this.textContent + "</" + tag + ">";
  }
}

class MiniText extends MiniNode {
  constructor(data, type = 3) {
    super(type, type === 3 ? "#text" : "#comment");
    this.data = data;
  }
  get nodeValue() { return this.data; }
  set nodeValue(value) { this.data = value; }
}

const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const parseAttributes = (source) => {
  const attributes = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    attributes[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
};

export function parseMiniHtml(html) {
  const document = new MiniNode(9, "#document");
  const stack = [document];
  const top = () => stack.at(-1);
  const TOKEN = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
  let match;
  while ((match = TOKEN.exec(html)) !== null) {
    const [whole, closing, opening, rest] = match;
    if (whole.startsWith("<!--")) {
      top().appendChild(new MiniText(whole.slice(4, -3), 8));
    } else if (closing) {
      const name = closing.toUpperCase();
      const at = stack.findLastIndex((node) => node.nodeName === name);
      if (at > 0) stack.length = at;
    } else if (opening) {
      const tag = opening.toLowerCase();
      const element = top().appendChild(new MiniElement(tag, parseAttributes(rest ?? "")));
      if (RAW_TEXT.has(tag)) {
        const end = html.toLowerCase().indexOf("</" + tag, TOKEN.lastIndex);
        const stop = end === -1 ? html.length : end;
        element.appendChild(new MiniText(html.slice(TOKEN.lastIndex, stop)));
        TOKEN.lastIndex = stop;
      } else if (!VOID.has(tag) && !String(rest).trim().endsWith("/")) {
        stack.push(element);
      }
    } else {
      top().appendChild(new MiniText(decode(whole)));
    }
  }
  return document;
}

// window.DOMParser stand-in: parseFromString(html) returns the mini document.
export class MiniDOMParser {
  parseFromString(html) { return parseMiniHtml(String(html)); }
}
