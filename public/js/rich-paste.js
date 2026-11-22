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

// Batch H: pasting rich HTML (from a web page, a word processor) into a
// composer becomes the forum's Markdown, via the vendored turndown, loaded
// only on the first rich paste. Plain-text pastes, pastes carrying files
// (composer-paste.js stages those images) and oversized HTML keep the
// browser's default. Safety: turndown parses with the browser's inert
// DOMParser (no scripts run, no images load); script/style/media/frames/forms
// are dropped whole; images inside the HTML are stripped (only pasted image
// FILES attach); links keep http(s), mailto and site paths only; and the
// result is plain text typed into the textarea, never markup on the page.
// The insertion goes through field-edit.js, so Ctrl/Cmd+Z undoes it.
import { insertAtCaret } from "./field-edit.js";

// Mirrors constants.mjs (pinned equal by tests/batch-h-composer-input.test.mjs).
export const RICH_PASTE_MAX_HTML_CHARS = 200000;

const DROPPED_TAGS = [
  "script", "style", "noscript", "template", "iframe", "frame", "frameset", "object", "embed",
  "img", "picture", "source", "svg", "math", "canvas", "video", "audio", "track", "map",
  "form", "input", "button", "select", "option", "textarea", "head", "title", "meta", "link",
];
// Tags that make an HTML flavour worth converting (formatting or structure).
const RICH_TAG = /<(?:b|strong|i|em|u|s|del|strike|a|ul|ol|li|h[1-6]|pre|code|blockquote|p|div|br|table|tr)\b/i;
const SAFE_SCHEME = /^(?:https?:|mailto:)/i;

const defaultLoadTurndown = async () => (await import("./vendor/turndown.js")).default;

// A link destination the forum may keep, percent-encoding spaces and
// parentheses so the Markdown link stays intact; null drops the link.
export function safeLinkHref(href) {
  const value = String(href ?? "").trim();
  if (!value) return null;
  const sitePath = value.startsWith("/") && !value.startsWith("//");
  if (!sitePath && !SAFE_SCHEME.test(value)) return null;
  return value.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// The HTML flavour of a paste when it should be converted, else null.
export function richHtmlFrom(clipboardData) {
  if (!clipboardData) return null;
  if ((clipboardData.files?.length ?? 0) > 0) return null;
  const types = Array.from(clipboardData.types ?? []);
  if (!types.includes("text/html")) return null;
  const html = String(clipboardData.getData("text/html") ?? "");
  if (!html || html.length > RICH_PASTE_MAX_HTML_CHARS || !RICH_TAG.test(html)) return null;
  return html;
}

const elementIndex = (node) => Array.from(node.parentNode?.childNodes ?? [])
  .filter((sibling) => sibling.nodeType === 1)
  .indexOf(node);

// Builds the html -> Markdown converter from turndown's constructor.
export function createHtmlToMarkdown(TurndownService) {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  // markdown.js has no backslash escapes, so turndown's would show literally.
  service.escape = (text) => text;
  // A rule (not remove()): turndown checks rules first, so its own image
  // rule would otherwise win over a removal.
  service.addRule("forumDropped", { filter: DROPPED_TAGS, replacement: () => "" });
  service.addRule("forumStrike", {
    filter: ["del", "s", "strike"],
    replacement: (content) => (content.trim() ? "~~" + content + "~~" : content),
  });
  service.addRule("forumListItem", {
    filter: "li",
    replacement: (content, node) => {
      const parent = node.parentNode;
      const ordered = parent?.nodeName === "OL";
      const start = Number(parent?.getAttribute?.("start")) || 1;
      const prefix = ordered ? (start + elementIndex(node)) + ". " : "- ";
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n/g, "\n  ");
      return prefix + body + (node.nextSibling ? "\n" : "");
    },
  });
  service.addRule("forumLink", {
    filter: "a",
    replacement: (content, node) => {
      const href = safeLinkHref(node.getAttribute("href"));
      return href && content.trim() ? "[" + content + "](" + href + ")" : content;
    },
  });
  return (html) => service.turndown(String(html ?? "")).trim();
}

let converterPromise = null;

// Wires one field; returns the paste handler (a promise per paste) for tests.
export function attachRichPaste(field, { loadTurndown = null } = {}) {
  const converter = () => {
    if (loadTurndown) return loadTurndown().then(createHtmlToMarkdown);
    converterPromise ??= defaultLoadTurndown().then(createHtmlToMarkdown);
    converterPromise.catch(() => { converterPromise = null; });
    return converterPromise;
  };
  let cached = null;
  const handle = async (event) => {
    const html = richHtmlFrom(event?.clipboardData);
    if (!html) return;
    event.preventDefault();
    const plain = String(event.clipboardData.getData("text/plain") ?? "");
    let markdown;
    try {
      cached ??= await converter();
      markdown = cached(html);
    } catch {
      // turndown failed to load or convert: the plain flavour goes in instead.
      cached = null;
      markdown = "";
    }
    insertAtCaret(field, markdown || plain);
  };
  field?.addEventListener?.("paste", handle);
  return handle;
}
