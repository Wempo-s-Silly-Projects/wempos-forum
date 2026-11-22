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

// Batch H: the post composer and chat input. Pins the vendored libraries
// (text-field-edit, turndown, picmo + emojibase data, fuzzysort, split.js)
// byte for byte with their REUSE licensing; the native-undo insertion route
// every formatting insertion takes; the formatting toolbar; rich-HTML paste
// to Markdown (with no script, image or javascript: link surviving); fuzzy
// @mention ranking; the lazy emoji picker; the side-by-side preview; textarea
// autogrow; and the new composer.* strings in every locale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as constants from "../constants.mjs";
import { insertAtCaret, replaceFieldRange } from "../public/js/field-edit.js";
import { FORMAT_KINDS, applyFormat, planFormat } from "../public/js/composer-format.js";
import { createComposerToolbar, shortcutFormat } from "../public/js/composer-toolbar.js";
import {
  RICH_PASTE_MAX_HTML_CHARS, attachRichPaste, createHtmlToMarkdown, richHtmlFrom, safeLinkHref,
} from "../public/js/rich-paste.js";
import { MAX_MENTION_SUGGESTIONS, insertMention, rankMentionUsers } from "../public/js/mention-picker.js";
import {
  EMOJIBASE_LOCALES, EMOJIBASE_PATH, PICMO_CSS_HREF, emojibaseLocaleFor, openEmojiPicker, picmoI18n,
} from "../public/js/emoji-picker.js";
import { COMPOSER_AUTOGROW_MAX_PX, attachAutogrow } from "../public/js/autogrow.js";
import { createComposePreview } from "../public/js/compose-preview.js";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { MiniDOMParser } from "./helpers/mini-html.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sha256 = (path) => createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex");
const tick = () => new Promise((resolve) => setImmediate(resolve));
globalThis.HTMLElement ??= class {};

// A document that behaves like the browser's editing host: insertText edits
// the focused field and pushes onto a native undo stack; "undo" pops it.
function makeEditingDocument(base = {}) {
  const doc = {
    ...base,
    activeElement: null,
    calls: [],
    undoStack: [],
    execCommand(command, _ui, text) {
      doc.calls.push(command);
      const field = doc.activeElement;
      if (!field) return false;
      if (command === "insertText" || command === "delete") {
        doc.undoStack.push({ value: field.value, start: field.selectionStart, end: field.selectionEnd });
        const inserted = command === "delete" ? "" : String(text);
        field.value = field.value.slice(0, field.selectionStart) + inserted + field.value.slice(field.selectionEnd);
        const caret = field.selectionStart + inserted.length;
        field.selectionStart = caret;
        field.selectionEnd = caret;
        field.dispatchEvent({ type: "input" });
        return true;
      }
      if (command === "undo") {
        const previous = doc.undoStack.pop();
        if (!previous) return false;
        field.value = previous.value;
        field.setSelectionRange(previous.start, previous.end);
        return true;
      }
      return false;
    },
  };
  return doc;
}

function makeField(doc, value = "", start = value.length, end = start) {
  const field = {
    id: "body-field",
    value,
    selectionStart: start,
    selectionEnd: end,
    ownerDocument: doc,
    listeners: {},
    inputs: 0,
    style: {},
    focus() { doc.activeElement = field; },
    blur() { if (doc.activeElement === field) doc.activeElement = null; },
    setSelectionRange(from, to) { field.selectionStart = from; field.selectionEnd = to; },
    setRangeText(text, from, to) {
      field.value = field.value.slice(0, from) + text + field.value.slice(to);
      field.selectionStart = from + text.length;
      field.selectionEnd = field.selectionStart;
    },
    addEventListener(type, listener) { (field.listeners[type] ??= []).push(listener); },
    dispatchEvent(event) {
      if (event.type === "input") field.inputs += 1;
      for (const listener of field.listeners[event.type] ?? []) listener(event);
      return true;
    },
    insertAdjacentElement() {},
  };
  return field;
}

// ------------------------------------------------------------- vendor identity

const VENDOR = {
  "public/js/vendor/text-field-edit.js": "7acad2eaf12c3c691e28b16e190045a59ec1b3725d23a524f084a876a55716d6",
  "public/js/vendor/turndown.js": "bea8cd6ac440d6fcf5b3617c7ba49fb2917beedfc8522c0af7c95ce9a6214354",
  "public/js/vendor/picmo.js": "c6aa345305d1c49eacba7284a8b2aa7b2c55269ec21e5a469b2bfe9798d8efb7",
  "public/js/vendor/picmo.css": "f8049e5f746c5cbe836c525fca078dd3ee034bae651d8ba9c49246e074cf44ec",
  "public/js/vendor/fuzzysort.min.js": "42ff4ca9327e099983adba294d9fefb76079068d9afc438177dd99030ad61781",
  "public/js/vendor/split.js": "cbec679982e03b4ac4e7d94acd5b1cc0a650e8257091b1577d157fcbf5556124",
};
const EMOJIBASE_TREE_SHA256 = "0824e8ba4bd1bbf601565cff69a7dc8a8081b89655f2d1a4b568e8d5d8dc5f40";

test("each vendored composer library is the approved upstream file, byte for byte", () => {
  for (const [path, digest] of Object.entries(VENDOR)) assert.equal(sha256(path), digest, path);
});

test("the vendored emojibase-data 18.0.0 tree (data + messages per locale) is pinned as a whole", () => {
  const dir = new URL("public/js/vendor/emojibase/", ROOT);
  const lines = readdirSync(dir).sort().flatMap((locale) =>
    ["data.json", "messages.json"].map((file) =>
      sha256(`public/js/vendor/emojibase/${locale}/${file}`) + "  emojibase/" + locale + "/" + file + "\n"));
  assert.equal(createHash("sha256").update(lines.join("")).digest("hex"), EMOJIBASE_TREE_SHA256);
  assert.deepEqual(readdirSync(dir).sort(), [...EMOJIBASE_LOCALES].sort());
});

test("REUSE.toml annotates every new vendored file as MIT with its upstream copyright", () => {
  const blocks = read("REUSE.toml").split("[[annotations]]");
  const holders = {
    "public/js/vendor/text-field-edit.js": "Federico Brigante",
    "public/js/vendor/turndown.js": "Dom Christie",
    "public/js/vendor/picmo.js": "Joe Attardi",
    "public/js/vendor/picmo.css": "Joe Attardi",
    "public/js/vendor/fuzzysort.min.js": "Stephen Kamenar",
    "public/js/vendor/split.js": "Nathan Cahill",
    "public/js/vendor/emojibase/**": "Miles Johnson",
  };
  for (const [path, holder] of Object.entries(holders)) {
    const block = blocks.find((part) => part.includes(`"${path}"`));
    assert.ok(block, "an annotations block names " + path);
    assert.match(block, /SPDX-License-Identifier = "MIT"/);
    assert.match(block, /precedence = "override"/);
    assert.ok(block.includes(holder), path + " credits " + holder);
  }
  // Specific blocks must come after the public/js/vendor/** glob (last wins).
  const reuse = read("REUSE.toml");
  assert.ok(reuse.indexOf('"public/js/vendor/text-field-edit.js"') > reuse.indexOf('"public/js/vendor/**"'));
});

test("caps live in root constants.mjs and the client mirrors them", () => {
  assert.equal(constants.RICH_PASTE_MAX_HTML_CHARS, 200000);
  assert.equal(constants.COMPOSER_AUTOGROW_MAX_PX, 480);
  assert.equal(RICH_PASTE_MAX_HTML_CHARS, constants.RICH_PASTE_MAX_HTML_CHARS);
  assert.equal(COMPOSER_AUTOGROW_MAX_PX, constants.COMPOSER_AUTOGROW_MAX_PX);
});

// ------------------------------------------------------------- field edits

test("a programmatic insert goes through execCommand(insertText), so Ctrl/Cmd+Z undoes it", () => {
  const doc = makeEditingDocument();
  const field = makeField(doc, "hello world", 6, 11);
  replaceFieldRange(field, 6, 11, "there");
  assert.equal(field.value, "hello there");
  assert.deepEqual(doc.calls, ["insertText"]);
  assert.equal(field.inputs, 1, "the native edit fires one input event");
  doc.execCommand("undo");
  assert.equal(field.value, "hello world");
});

test("insertAtCaret replaces the selection; without execCommand it splices and still fires input", () => {
  const doc = { activeElement: null, execCommand: () => false };
  const field = makeField(doc, "ab", 1, 1);
  insertAtCaret(field, "X");
  assert.equal(field.value, "aXb");
  assert.equal(field.selectionStart, 2);
  assert.equal(field.inputs, 1);
});

// ------------------------------------------------------------- formatting

test("planFormat wraps bold, keeps the inner selection, and toggles back off", () => {
  const on = planFormat("make it loud", 8, 12, "bold");
  assert.deepEqual(on, { start: 8, end: 12, text: "**loud**", selectStart: 10, selectEnd: 14 });
  const off = planFormat("make it **loud**", 10, 14, "bold");
  assert.deepEqual(off, { start: 8, end: 16, text: "loud", selectStart: 8, selectEnd: 12 });
});

test("planFormat spoiler with no selection drops the caret between the markers", () => {
  assert.deepEqual(planFormat("ab", 1, 1, "spoiler"), { start: 1, end: 1, text: "||||", selectStart: 3, selectEnd: 3 });
});

test("planFormat prefixes every selected line for quote, list and heading", () => {
  const value = "intro\none\ntwo";
  assert.equal(planFormat(value, 7, 13, "quote").text, "> one\n> two");
  assert.equal(planFormat(value, 7, 13, "quote").start, 6);
  assert.equal(planFormat(value, 8, 8, "list").text, "- one");
  assert.equal(planFormat("title", 0, 0, "heading").text, "# title");
});

test("planFormat link selects the URL slot; code block lands on its own lines", () => {
  const link = planFormat("see docs", 4, 8, "link");
  assert.equal(link.text, "[docs](https://)");
  assert.equal("see " + link.text.slice(0, 0), "see ");
  assert.deepEqual([link.selectStart, link.selectEnd], [11, 19]);
  const block = planFormat("ab", 1, 1, "codeBlock");
  assert.equal(block.text, "\n```\n\n```\n");
});

test("FORMAT_KINDS label every button with an existing format.* key", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const kind of FORMAT_KINDS) {
    assert.ok(en[kind.labelKey], kind.labelKey);
    assert.ok(kind.glyph && !/[a-z]{2,}/i.test(kind.glyph), "glyph is a language-neutral marker: " + kind.glyph);
  }
});

test("applyFormat routes through the native undo path", () => {
  const doc = makeEditingDocument();
  const field = makeField(doc, "hush", 0, 4);
  applyFormat(field, "spoiler");
  assert.equal(field.value, "||hush||");
  assert.deepEqual([field.selectionStart, field.selectionEnd], [2, 6]);
  doc.execCommand("undo");
  assert.equal(field.value, "hush");
});

// ------------------------------------------------------------- toolbar

test("the toolbar is an accessible roving-tabindex toolbar; a button click formats with undo", () => {
  const doc = makeEditingDocument(makeFakeDocument());
  const field = makeField(doc, "word", 0, 4);
  const toolbar = createComposerToolbar(field, doc, { emoji: false });
  assert.equal(toolbar.getAttribute("role"), "toolbar");
  assert.equal(toolbar.getAttribute("aria-label"), "composer.toolbarLabel");
  assert.equal(toolbar.getAttribute("aria-controls"), "body-field");
  const buttons = Array.from(toolbar.querySelectorAll("button"));
  assert.equal(buttons.length, FORMAT_KINDS.length);
  assert.deepEqual(buttons.map((button) => button.tabIndex), [0, ...Array(buttons.length - 1).fill(-1)]);
  assert.ok(buttons.every((button) => button.type === "button" && button.getAttribute("aria-label")));
  const bold = buttons.find((button) => button.dataset.format === "bold");
  bold.dispatch("click");
  assert.equal(field.value, "**word**");
  doc.execCommand("undo");
  assert.equal(field.value, "word");
  // Arrow keys move focus along the toolbar.
  let prevented = false;
  buttons[0].focus();
  toolbar.dispatch("keydown", { key: "ArrowRight", target: buttons[0], preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(buttons[1].tabIndex, 0);
  assert.equal(buttons[0].tabIndex, -1);
});

test("Ctrl/Cmd+B, I and K format from the textarea; plain keys and Shift combos do not", () => {
  assert.equal(shortcutFormat({ key: "b", ctrlKey: true }), "bold");
  assert.equal(shortcutFormat({ key: "I", metaKey: true }), "italic");
  assert.equal(shortcutFormat({ key: "k", ctrlKey: true }), "link");
  assert.equal(shortcutFormat({ key: "b" }), null);
  assert.equal(shortcutFormat({ key: "b", ctrlKey: true, altKey: true }), null);
  assert.equal(shortcutFormat({ key: "b", ctrlKey: true, isComposing: true }), null);
  const doc = makeEditingDocument(makeFakeDocument());
  const field = makeField(doc, "x", 0, 1);
  createComposerToolbar(field, doc, { emoji: false });
  let prevented = false;
  field.dispatchEvent({ type: "keydown", key: "i", ctrlKey: true, preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(field.value, "*x*");
});

// ------------------------------------------------------------- rich paste

let toMarkdown;
async function htmlToMarkdown(html) {
  if (!toMarkdown) {
    globalThis.window = { DOMParser: MiniDOMParser };
    const { default: TurndownService } = await import("../public/js/vendor/turndown.js");
    toMarkdown = createHtmlToMarkdown(TurndownService);
  }
  return toMarkdown(html);
}

test("turndown turns a rich sample into the forum's Markdown dialect", async () => {
  const html = "<h2>Title</h2><p>Hello <strong>bold</strong> and <em>it</em> <del>gone</del> snake_case</p>" +
    "<ul><li>one</li><li>two</li></ul><blockquote><p>quoted</p></blockquote>" +
    "<pre><code>x = 1</code></pre><p><a href=\"https://example.com/a\">site</a></p>";
  assert.equal(await htmlToMarkdown(html),
    "## Title\n\nHello **bold** and *it* ~~gone~~ snake_case\n\n- one\n- two\n\n> quoted\n\n" +
    "```\nx = 1\n```\n\n[site](https://example.com/a)");
});

test("pasted HTML cannot smuggle script, images, frames or javascript: links", async () => {
  const html = "<p>safe</p><script>alert(1)</script><style>p{}</style><img src=x onerror=\"alert(2)\">" +
    "<iframe src=\"https://evil.example\"></iframe><a href=\"javascript:alert(3)\">click</a> " +
    "<a href=\"data:text/html,x\">data</a> <svg><script>alert(4)</script></svg><a href=\"/posts/1\">local</a>";
  const markdown = await htmlToMarkdown(html);
  assert.doesNotMatch(markdown, /alert|javascript:|data:|<script|onerror|evil\.example|!\[/i);
  assert.match(markdown, /safe/);
  assert.match(markdown, /click/);
  assert.match(markdown, /\[local\]\(\/posts\/1\)/);
});

test("safeLinkHref keeps http(s), mailto and site paths only", () => {
  assert.equal(safeLinkHref("https://a.example/x y"), "https://a.example/x%20y");
  assert.equal(safeLinkHref("/posts/2"), "/posts/2");
  assert.equal(safeLinkHref("mailto:a@b.example"), "mailto:a@b.example");
  for (const bad of ["javascript:alert(1)", " JavaScript:x", "data:x", "vbscript:x", "//evil.example", "", null]) {
    assert.equal(safeLinkHref(bad), null, String(bad));
  }
});

const clipboard = (types, files = []) => ({
  types: Object.keys(types),
  files,
  getData: (type) => types[type] ?? "",
});

test("only rich HTML converts: plain text, files and oversized HTML keep the default paste", () => {
  assert.equal(richHtmlFrom(clipboard({ "text/plain": "hi" })), null);
  assert.equal(richHtmlFrom(clipboard({ "text/html": "<b>x</b>" }, [{ name: "a.png" }])), null);
  assert.equal(richHtmlFrom(clipboard({ "text/html": "<meta charset=utf-8><span>plain</span>" })), null);
  assert.equal(richHtmlFrom(clipboard({ "text/html": "<p>" + "x".repeat(RICH_PASTE_MAX_HTML_CHARS) + "</p>" })), null);
  assert.equal(richHtmlFrom(clipboard({ "text/html": "<p>a <b>b</b></p>" })), "<p>a <b>b</b></p>");
  assert.equal(richHtmlFrom(null), null);
});

test("a rich paste is converted lazily and inserted at the caret through the undo path", async () => {
  const doc = makeEditingDocument();
  const field = makeField(doc, "[]", 1, 1);
  let loads = 0;
  const handle = attachRichPaste(field, {
    loadTurndown: async () => {
      loads += 1;
      globalThis.window = { DOMParser: MiniDOMParser };
      return (await import("../public/js/vendor/turndown.js")).default;
    },
  });
  let prevented = false;
  await handle({ clipboardData: clipboard({ "text/html": "<b>hi</b>", "text/plain": "hi" }), preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(field.value, "[**hi**]");
  assert.deepEqual(doc.calls, ["insertText"]);
  await handle({ clipboardData: clipboard({ "text/plain": "plain" }), preventDefault: () => assert.fail("plain text keeps the default") });
  assert.equal(loads, 1, "turndown loads only for a rich paste");
  assert.ok(field.listeners.paste?.length, "the handler is registered on the field");
});

test("a failed conversion falls back to the plain-text flavour", async () => {
  const doc = makeEditingDocument();
  const field = makeField(doc, "");
  const handle = attachRichPaste(field, { loadTurndown: async () => { throw new Error("offline"); } });
  await handle({ clipboardData: clipboard({ "text/html": "<b>hi</b>", "text/plain": "hi" }), preventDefault() {} });
  assert.equal(field.value, "hi");
});

// ------------------------------------------------------------- mentions

test("fuzzysort ranks exact, then prefix, then contiguous, then scattered matches", () => {
  const users = ["j_o_x", "mojo", "jordan", "John", "jo", "alice"].map((username) => ({ username }));
  assert.deepEqual(rankMentionUsers(users, "jo").map((user) => user.username), ["jo", "John", "jordan", "mojo", "j_o_x"]);
  assert.deepEqual(rankMentionUsers([{ username: "Bob" }, { username: "zed_bob" }, { username: "bobby" }, { bio: "bob" }], "bob")
    .map((user) => user.username), ["Bob", "bobby", "zed_bob"]);
  assert.equal(rankMentionUsers(Array.from({ length: 20 }, (_, i) => ({ username: "user" + i })), "user").length, MAX_MENTION_SUGGESTIONS);
  assert.deepEqual(rankMentionUsers(null, "x"), []);
});

test("mention-picker ranks with the vendored fuzzysort", () => {
  assert.match(read("public/js/mention-picker.js"), /from "\.\/vendor\/fuzzysort\.min\.js"/);
});

test("picking a mention inserts through the undo path", () => {
  const doc = makeEditingDocument();
  const field = makeField(doc, "hi @bo!", 6, 6);
  insertMention(field, 3, 6, "bob");
  assert.equal(field.value, "hi @bob !");
  assert.equal(field.selectionStart, 8);
  doc.execCommand("undo");
  assert.equal(field.value, "hi @bo!");
});

// ------------------------------------------------------------- emoji picker

test("forum locales map onto vendored emojibase locales, falling back to English", () => {
  assert.equal(emojibaseLocaleFor("de"), "de");
  assert.equal(emojibaseLocaleFor("zh-Hans"), "zh");
  assert.equal(emojibaseLocaleFor("zh-Hant"), "zh-hant");
  assert.equal(emojibaseLocaleFor("pt"), "pt");
  assert.equal(emojibaseLocaleFor("ab"), "en");
  assert.equal(emojibaseLocaleFor(undefined), "en");
  for (const locale of EMOJIBASE_LOCALES) {
    assert.ok(existsSync(new URL(`public/js/vendor/emojibase/${locale}/data.json`, ROOT)), locale);
  }
});

test("picmo's strings come from emojibase group names plus our t() keys", () => {
  const i18n = picmoI18n({ groups: [{ key: "smileys-emotion", message: "Smileys & Emotionen" }] });
  assert.equal(i18n["categories.smileys-emotion"], "Smileys & Emotionen");
  assert.equal(i18n["categories.recents"], "composer.emojiRecents");
  assert.equal(i18n.search, "common.search");
  assert.equal(i18n["search.notFound"], "composer.emojiNotFound");
  assert.equal(i18n["error.load"], "composer.emojiError");
  assert.equal(i18n.retry, "common.retry");
  assert.equal(i18n["recents.none"], "composer.emojiRecentsNone");
  assert.equal(i18n["search.clear"], "composer.emojiClear");
});

test("the emoji picker lazy-loads once, reads local emojibase data, and inserts with undo", async () => {
  const fake = makeFakeDocument();
  const head = new FakeNode("head");
  const doc = makeEditingDocument({ ...fake, head });
  const field = makeField(doc, "hi ", 3, 3);
  const host = new FakeNode("div");
  const requested = [];
  let loads = 0;
  let handler = null;
  const options = [];
  const deps = {
    locale: "de",
    fetchJson: async (path) => { requested.push(path); return path.endsWith("messages.json") ? { groups: [] } : [{ emoji: "😀" }]; },
    loadPicmo: async () => {
      loads += 1;
      return {
        globalConfig: { injectStyles: true },
        InMemoryStoreFactory: "memory",
        createPicker: (opts) => {
          options.push(opts);
          return { addEventListener: (type, fn) => { if (type === "emoji:select") handler = fn; }, destroy() {} };
        },
      };
    },
  };
  const first = await openEmojiPicker(field, host, doc, deps);
  assert.equal(first.picmo.globalConfig.injectStyles, false, "picmo's inline <style> is off (CSP style-src 'self')");
  assert.equal(head.querySelectorAll("link").length, 1);
  assert.equal(head.querySelector("link").href, PICMO_CSS_HREF);
  assert.deepEqual(requested, [EMOJIBASE_PATH + "de/data.json", EMOJIBASE_PATH + "de/messages.json"]);
  assert.equal(options[0].locale, "de");
  assert.equal(options[0].dataStore, "memory", "no IndexedDB copy of the data");
  handler({ emoji: "😀" });
  assert.equal(field.value, "hi 😀");
  doc.execCommand("undo");
  assert.equal(field.value, "hi ");
  await openEmojiPicker(field, host, doc, deps);
  assert.equal(loads, 1);
  assert.equal(head.querySelectorAll("link").length, 1, "the stylesheet is linked once");
});

// ------------------------------------------------------------- side by side

test("on wide screens the preview can sit side by side, splitting via a lazy split.js", async () => {
  const document = makeFakeDocument();
  const form = new FakeNode("form");
  const fieldWrapper = new FakeNode("div");
  fieldWrapper.className = "form-field";
  const bodyField = new FakeNode("textarea");
  bodyField.value = "**hi**";
  fieldWrapper.append(bodyField);
  form.append(fieldWrapper);
  const calls = [];
  const preview = createComposePreview(bodyField, document, {
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    loadSplit: async () => (elements, options) => {
      calls.push({ elements, options });
      return { destroy: () => calls.push("destroy") };
    },
  });
  form.append(preview);
  const toggle = findByClass(preview, "compose-split-toggle");
  assert.ok(toggle, "a side-by-side toggle");
  assert.equal(toggle.hidden, false);
  assert.equal(toggle.textContent, "composer.sideBySide");
  toggle.dispatch("click");
  await tick();
  const split = findByClass(form, "compose-split");
  assert.ok(split, "a split container");
  const pane = findByClass(form, "compose-preview-pane");
  assert.equal(pane.hidden, false, "the preview opens with the split");
  assert.equal(calls[0].elements[0], fieldWrapper);
  assert.equal(calls[0].elements[1], pane);
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  toggle.dispatch("click");
  await tick();
  assert.equal(calls.at(-1), "destroy");
  assert.equal(findByClass(form, "compose-split"), null);
  assert.equal(fieldWrapper.parentNode, form);
});

test("narrow screens never see the side-by-side toggle", () => {
  const preview = createComposePreview(new FakeNode("textarea"), makeFakeDocument(), {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  });
  assert.equal(findByClass(preview, "compose-split-toggle").hidden, true);
});

// ------------------------------------------------------------- autogrow

test("autogrow is CSS field-sizing first, with a capped JS fallback only when unsupported", () => {
  const doc = { activeElement: null };
  const native = makeField(doc);
  attachAutogrow(native, { supports: () => true });
  assert.equal(native.listeners.input, undefined);
  const fallback = makeField(doc);
  fallback.scrollHeight = 900;
  attachAutogrow(fallback, { supports: () => false });
  fallback.dispatchEvent({ type: "input" });
  assert.equal(fallback.style.height, COMPOSER_AUTOGROW_MAX_PX + "px");
  fallback.scrollHeight = 120;
  fallback.dispatchEvent({ type: "input" });
  assert.equal(fallback.style.height, "120px");
  const css = read("public/styles.css");
  assert.match(css, /field-sizing:\s*content/);
});

// ------------------------------------------------------------- wiring

test("the composer seats the toolbar, rich paste and autogrow on its body field", () => {
  const source = read("public/js/routes/composer.js");
  assert.match(source, /createComposerToolbar\(bodyField, document\)/);
  assert.match(source, /attachRichPaste\(bodyField\)/);
  assert.match(source, /attachAutogrow\(bodyField\)/);
});

test("the chat inputs get the emoji picker, autogrow, mentions and undo-safe reply prefill", () => {
  const dm = read("public/js/chat-widget-composer.js");
  assert.match(dm, /createEmojiButton\(/);
  assert.match(dm, /attachAutogrow\(ui\.composerEl\)/);
  const lobby = read("public/js/chat-widget-lobby.js");
  assert.match(lobby, /createEmojiButton\(/);
  assert.match(lobby, /attachMentionPicker\(input, document\)/);
  assert.match(lobby, /replaceFieldRange\(lobbyInputEl/);
  assert.doesNotMatch(lobby, /lobbyInputEl\.value = withReplyMention/);
});

test("quotes prefill through the undo path", async () => {
  const { prefillQuote } = await import("../public/js/quotes.js");
  const doc = makeEditingDocument();
  const field = makeField(doc, "mine", 4, 4);
  prefillQuote(field, "ann", "said this");
  assert.equal(field.value, "> @ann: said this\nmine");
  doc.execCommand("undo");
  assert.equal(field.value, "mine");
});

// ------------------------------------------------------------- strings

const NEW_KEYS = [
  "composer.toolbarLabel", "composer.emoji", "composer.emojiNotFound", "composer.emojiError",
  "composer.emojiRecents", "composer.emojiRecentsNone", "composer.emojiClear", "composer.sideBySide",
];

test("the new composer.* strings exist, non-empty, in every locale as one contiguous block", () => {
  const dir = new URL("public/locales/", ROOT);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const text = readFileSync(new URL(file, dir), "utf8");
    const messages = JSON.parse(text);
    const keys = Object.keys(messages);
    for (const key of NEW_KEYS) assert.ok(typeof messages[key] === "string" && messages[key].trim(), file + " " + key);
    const at = keys.indexOf(NEW_KEYS[0]);
    assert.deepEqual(keys.slice(at, at + NEW_KEYS.length), NEW_KEYS, file + " keeps the block contiguous");
  }
});
