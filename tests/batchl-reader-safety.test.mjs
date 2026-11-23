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

// Batch L items 1, 2, 4 (client side) and the vendored libraries: the
// "Hide strong language" blur (device pref, off by default, never touches
// stored text), the lookalike-host interstitial (punycode + tldts), the
// franc-min language hint (lang attribute, no network), the click-to-load
// link preview card (never an image), the one render.js hook, and the
// verbatim vendor files with their sha256 and REUSE licensing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import * as constants from "../constants.mjs";
import { toASCII } from "../public/js/vendor/punycode/punycode.es6.js";
import { analyzeHost, createLinkWarning, interceptSuspiciousLink, registrableDomain } from "../public/js/link-safety.js";
import {
  STRONG_LANGUAGE_LIST_IDS, STRONG_LANGUAGE_STORAGE_KEY, blurStrongLanguage, createStrongLanguageToggle,
  loadStrongLanguage, readHideStrongLanguage,
} from "../public/js/strong-language.js";
import { LANG_DETECT_MIN_CHARS, applyPostLanguage, detectLanguage } from "../public/js/lang-detect.js";
import { addPreviewButtons, standaloneLink } from "../public/js/link-preview.js";
import { renderBodyBlocks } from "../public/js/render.js";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const memoryStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
};

// ---------------------------------------------------------------- vendor

const VENDOR = Object.freeze({
  "public/js/vendor/tldts/index.esm.min.js": "1a5b60685de5e750934fccb85d5759829dd4dc7f6d88a684d33fd01687497208",
  "public/js/vendor/punycode/punycode.es6.js": "8969ae1b78644a33574be197d1a7a9c85b031092f1c1a657d865b7b3c1edd77e",
  "public/js/vendor/bad-words-next/decode.mjs": "5f5bead412365dcafe55d28ef516faea61a7ac76cba87a998ac6885d7311f400",
  "public/js/vendor/bad-words-next/en.mjs": "0ab361ba2f07e0fb0697934d7d3afbdc7d82587c8e0bd6e98c6399d0684fdb90",
  "public/js/vendor/bad-words-next/es.mjs": "fac13ad15ddd048bb322a8bbd2011f5d58118e6d7dd48ced971ba9c20a5c50c6",
  "public/js/vendor/bad-words-next/fr.mjs": "d5eab9f548f466f4d5d2b317955fde32351656fdeab0da7a3742f292f5ebc3b6",
  "public/js/vendor/bad-words-next/de.mjs": "9d9f52f68cbdf08abe86eaa8da3b1f1d23f9bb0e92a8f47f9a5e9b38334e65d0",
  "public/js/vendor/bad-words-next/pl.mjs": "9dd0ccd55c96cb60d2e62e88c4dc454d497d57f9d9a762fc13d5fac471d28760",
  "public/js/vendor/bad-words-next/ru.mjs": "ab9c8fb4f97e108a6763c2a07b065b654c6ee40cea787b0bec53736b46e2768c",
  "public/js/vendor/bad-words-next/ru_lat.mjs": "3d020572aea87a9349e9f6da72997500d493903047bb104f53b7e9176895b46e",
  "public/js/vendor/bad-words-next/ua.mjs": "1f9faa7a2fe2b1db8665293796906e562d80448fcd4476e7e13785d9c34af619",
  "public/js/vendor/bad-words-next/ch.mjs": "2499cdda0b6ea43adabb5c13cf4b28618c2b577164a7d68d8a1d17aeb3beda0b",
  "public/js/vendor/franc-min/data.js": "8a9e225daa848446d520eefa658cae854bc945a6ae871547603f46f8323f148c",
  "public/js/vendor/franc-min/expressions.js": "228dbf44b56563664e528471f65145fb85a371aea5f8a9d222602cbde8706dc3",
});

test("each vendored library file is the upstream release, byte for byte", () => {
  for (const [path, sha] of Object.entries(VENDOR)) {
    const bytes = readFileSync(new URL(path, ROOT));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha, path);
  }
});

test("REUSE.toml annotates each new vendor folder MIT with its upstream holder, after the Prism block", () => {
  const reuse = read("REUSE.toml");
  const blocks = reuse.split("[[annotations]]");
  const prismAt = blocks.findIndex((part) => part.includes('"public/js/vendor/**"'));
  for (const [folder, holder] of [
    ["tldts", "Rémi Berson"], ["punycode", "Mathias Bynens"],
    ["bad-words-next", "Void Resort"], ["franc-min", "Titus Wormer"],
  ]) {
    const at = blocks.findIndex((part) => part.includes(`"public/js/vendor/${folder}/**"`));
    assert.ok(at > prismAt, folder + " block comes after (and so overrides) the Prism catch-all");
    assert.match(blocks[at], /SPDX-License-Identifier = "MIT"/);
    assert.match(blocks[at], /precedence = "override"/);
    assert.ok(blocks[at].includes(holder), folder + " names " + holder);
  }
});

test("package.json gains no browser library (vendored files only); no runtime CDN in the new modules", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const name of ["tldts", "punycode", "bad-words-next", "franc-min"]) {
    assert.equal(pkg.dependencies?.[name], undefined, name);
  }
  for (const file of ["link-safety.js", "strong-language.js", "lang-detect.js", "link-preview.js", "reader-safety.js"]) {
    for (const url of read("public/js/" + file).match(/https?:\/\/[^\s"'`)<>]+/g) ?? []) {
      assert.equal(new URL(url).hostname, "www.gnu.org", file + ": " + url);
    }
  }
});

// ---------------------------------------------------------------- homographs

test("analyzeHost: lookalike, mixed-script and whole-script-confusable hosts are suspicious", () => {
  for (const unicode of [
    "аpple.com", // Cyrillic а + Latin
    "аррӏе.com", // all Cyrillic lookalikes
    "gοogle.com", // Greek omicron
    "pаypal.com",
    "ɑpple.com", // Latin alpha
    "login.miсrosoft.com",
  ]) {
    const ascii = toASCII(unicode);
    const analysis = analyzeHost(ascii);
    assert.equal(analysis.suspicious, true, unicode + " (" + ascii + ")");
    assert.equal(analysis.ascii, ascii, "the real punycode host is reported");
    assert.equal(analysis.unicode, unicode);
  }
});

test("analyzeHost: plain ASCII and honest single-script IDN hosts pass", () => {
  for (const unicode of ["example.com", "wempos-forum.com", "münchen.de", "中国.cn", "日本語のサイト.jp", "한국.kr", "пример.рф", "ελλάδα.gr"]) {
    assert.equal(analyzeHost(toASCII(unicode)).suspicious, false, unicode);
  }
});

test("registrableDomain uses the vendored tldts (public-suffix aware)", async () => {
  assert.equal(await registrableDomain("login.xn--pple-43d.com"), "xn--pple-43d.com");
  assert.equal(await registrableDomain("a.b.example.co.uk"), "example.co.uk");
});

test("interceptSuspiciousLink: blocks a lookalike external link and shows the real host; lets safe links through", async () => {
  const document = makeFakeDocument({ body: new FakeNode("body") });
  const opened = [];
  const make = (href) => {
    const anchor = new FakeNode("a");
    anchor.setAttribute("href", href);
    anchor.href = href;
    return anchor;
  };
  let prevented = 0;
  const event = (target) => ({ target, button: 0, preventDefault() { prevented += 1; } });
  const evil = "https://" + toASCII("аpple.com") + "/login";
  assert.equal(interceptSuspiciousLink(event(make(evil)), document, { currentHost: "wempos-forum.com", open: (u) => opened.push(u) }), true);
  assert.equal(prevented, 1);
  const warning = findByClass(document.body, "link-warning");
  assert.ok(warning, "the interstitial is shown");
  assert.match(warning.textContent, /xn--pple-43d\.com/);
  assert.equal(opened.length, 0, "nothing opens until the reader chooses");
  assert.equal(interceptSuspiciousLink(event(make("https://example.com/")), document, { currentHost: "wempos-forum.com" }), false);
  assert.equal(interceptSuspiciousLink(event(make("/posts/1")), document, { currentHost: "wempos-forum.com" }), false);
  assert.equal(prevented, 1);
});

test("createLinkWarning: Continue opens the original href with noopener; Go back opens nothing", () => {
  const document = makeFakeDocument();
  const href = "https://" + toASCII("gοogle.com") + "/";
  const opened = [];
  const warning = createLinkWarning(document, href, analyzeHost(new URL(href).hostname), { open: (u) => opened.push(u) });
  findByClass(warning, "link-warning-back").dispatch("click");
  assert.equal(opened.length, 0);
  const again = createLinkWarning(document, href, analyzeHost(new URL(href).hostname), { open: (u) => opened.push(u) });
  findByClass(again, "link-warning-continue").dispatch("click");
  assert.deepEqual(opened, [href]);
  assert.equal(again.getAttribute("role"), "alertdialog");
});

// ---------------------------------------------------------------- strong language

test("Hide strong language is a device pref, off by default, stored as on/off", () => {
  assert.equal(readHideStrongLanguage(memoryStorage()), false);
  assert.equal(readHideStrongLanguage(null), false);
  assert.equal(readHideStrongLanguage({ getItem() { throw new Error("blocked"); } }), false);
  const storage = memoryStorage();
  const toggle = createStrongLanguageToggle(makeFakeDocument(), storage);
  const box = toggle.querySelector("input");
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatch("change");
  assert.equal(storage.map.get(STRONG_LANGUAGE_STORAGE_KEY), "on");
  assert.equal(readHideStrongLanguage(storage), true);
});

test("the matcher loads every vendored list (multi-language)", async () => {
  assert.deepEqual([...STRONG_LANGUAGE_LIST_IDS].sort(), ["ch", "de", "en", "es", "fr", "pl", "ru", "ru_lat", "ua"]);
  const matcher = await loadStrongLanguage();
  const hit = (text) => matcher.ranges(text).map(([start, end]) => text.slice(start, end));
  assert.deepEqual(hit("well fuck this"), ["fuck"]);
  assert.deepEqual(hit("Sh1t, the f*ck? FUCKING great."), ["Sh1t", "FUCKING"]);
  assert.deepEqual(hit("das ist scheiße"), ["scheiße"]);
  assert.deepEqual(hit("какой пиздец"), ["пиздец"]);
  assert.deepEqual(hit("a classic assessment of grass"), []);
});

function bodyArticle(document, texts) {
  const article = new FakeNode("div");
  for (const text of texts) {
    const p = new FakeNode("p");
    p.append(document.createTextNode(text));
    article.append(p);
  }
  return article;
}

test("blurStrongLanguage wraps matched words in click-to-reveal spans, keeps the text, skips code", async () => {
  const document = makeFakeDocument();
  const matcher = await loadStrongLanguage();
  const article = bodyArticle(document, ["what the fuck is this", "clean line"]);
  const code = new FakeNode("code");
  code.append(document.createTextNode("fuck()"));
  article.append(code);
  const before = article.textContent;
  assert.equal(blurStrongLanguage(document, article, matcher), 1);
  assert.equal(article.textContent, before, "the visible text is the same characters");
  const span = findByClass(article, "strong-language");
  assert.equal(span.getAttribute("role"), "button");
  assert.equal(span.getAttribute("tabindex"), "0");
  span.dispatch("click");
  assert.ok(span.classList.contains("is-revealed"));
  assert.equal(span.getAttribute("role"), null);
  assert.equal(blurStrongLanguage(document, article, matcher), 0, "idempotent");
});

test("profanity blur never changes stored text: renderBodyBlocks with the pref on leaves post.body untouched", async () => {
  const storage = memoryStorage({ [STRONG_LANGUAGE_STORAGE_KEY]: "on" });
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  try {
    const document = makeFakeDocument();
    const post = Object.freeze({ id: 7, body: "this is fucking great\n\nsecond paragraph" });
    const article = new FakeNode("article");
    renderBodyBlocks(post, document, article);
    for (let i = 0; i < 20; i += 1) await tick();
    assert.equal(post.body, "this is fucking great\n\nsecond paragraph");
    assert.ok(findByClass(article, "strong-language"), "the hook blurred the rendered word");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true, writable: true });
  }
});

test("the chat widget body and the settings panel are wired; render.js carries exactly one reader-safety hook", () => {
  const render = read("public/js/render.js");
  assert.equal(render.match(/applyReaderSafety\(/g)?.length, 1);
  assert.match(read("public/js/chat-widget-gifs.js"), /applyStrongLanguageBlur\(node\)/);
  assert.match(read("public/js/routes/feed.js"), /createStrongLanguageToggle\(document, storage\)/);
});

// ---------------------------------------------------------------- language hint

test("lang-detect mirrors the constant and detects common languages offline", async () => {
  assert.equal(LANG_DETECT_MIN_CHARS, constants.LANG_DETECT_MIN_CHARS);
  assert.equal(await detectLanguage("The quick brown fox jumps over the lazy dog while everyone watches the sunset."), "en");
  assert.equal(await detectLanguage("El rápido zorro marrón salta sobre el perro perezoso mientras todos miran la puesta de sol."), "es");
  assert.equal(await detectLanguage("Мы с друзьями вчера вечером долго обсуждали, какие книги стоит прочитать этим летом, и ничего не решили."), "ru");
  assert.equal(await detectLanguage("Le renard brun rapide saute par-dessus le chien paresseux pendant que tout le monde regarde."), "fr");
  assert.equal(await detectLanguage("too short"), null);
  assert.equal(await detectLanguage("```\nconst x = 1; const y = 2; const z = 3; return x + y + z;\n```"), null, "code is not prose");
});

test("applyPostLanguage sets lang on the body element only when confident", async () => {
  const article = new FakeNode("div");
  await applyPostLanguage(article, "Der schnelle braune Fuchs springt über den faulen Hund, während alle zuschauen.");
  assert.equal(article.getAttribute("lang"), "de");
  const short = new FakeNode("div");
  await applyPostLanguage(short, "ok!");
  assert.equal(short.getAttribute("lang"), null);
});

// ---------------------------------------------------------------- link preview card

function linkParagraph(document, href, label = href) {
  const p = new FakeNode("p");
  p.className = "post-body";
  const anchor = new FakeNode("a");
  anchor.setAttribute("href", href);
  anchor.href = href;
  anchor.textContent = label;
  p.append(anchor);
  return p;
}

test("standaloneLink: only a paragraph that is exactly one external https link", () => {
  const document = makeFakeDocument();
  assert.ok(standaloneLink(linkParagraph(document, "https://example.com/a"), "wempos-forum.com"));
  assert.equal(standaloneLink(linkParagraph(document, "http://example.com/a"), "wempos-forum.com"), null);
  assert.equal(standaloneLink(linkParagraph(document, "/posts/3"), "wempos-forum.com"), null);
  assert.equal(standaloneLink(linkParagraph(document, "https://wempos-forum.com/posts/3"), "wempos-forum.com"), null);
  const mixed = linkParagraph(document, "https://example.com/a");
  mixed.append(document.createTextNode(" and more words"));
  assert.equal(standaloneLink(mixed, "wempos-forum.com"), null);
});

test("addPreviewButtons: nothing is fetched until the reader clicks; the card has no image", async () => {
  const document = makeFakeDocument();
  const article = new FakeNode("article");
  article.append(linkParagraph(document, "https://example.com/a"));
  const requests = [];
  const request = async (path) => {
    requests.push(path);
    return { ok: true, preview: { url: "https://example.com/a", host: "example.com", title: "T", description: "D", siteName: "S" } };
  };
  assert.equal(addPreviewButtons(document, article, { request, currentHost: "wempos-forum.com" }), 1);
  assert.equal(requests.length, 0, "explicit network action only");
  await findByClass(article, "link-preview-show").fire("click");
  assert.deepEqual(requests, ["/api/link-preview?url=" + encodeURIComponent("https://example.com/a")]);
  const card = findByClass(article, "link-preview-card");
  assert.ok(card);
  assert.equal(card.querySelector("img"), null);
  assert.match(card.textContent, /T/);
  const link = card.querySelector("a");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer nofollow ugc");
});

test("addPreviewButtons: a refused preview shows the translated fallback, not an error", async () => {
  const document = makeFakeDocument();
  const article = new FakeNode("article");
  article.append(linkParagraph(document, "https://example.com/b"));
  addPreviewButtons(document, article, { request: async () => ({ ok: false }), currentHost: "wempos-forum.com" });
  await findByClass(article, "link-preview-show").fire("click");
  assert.ok(findByClass(article, "link-preview-unavailable"));
  assert.equal(findByClass(article, "link-preview-card"), null);
});

// ---------------------------------------------------------------- i18n

const SAFETY_KEYS = [
  "safety.hideStrongLanguage", "safety.hiddenWord", "safety.linkWarningTitle", "safety.linkWarningBody",
  "safety.linkWarningDomain", "safety.linkWarningBack", "safety.linkWarningContinue",
  "safety.previewShow", "safety.previewUnavailable", "safety.previewLabel",
];

test("every locale carries the safety.* keys as one contiguous block, translated", () => {
  const files = readdirSync(new URL("public/locales/", ROOT)).filter((name) => name.endsWith(".json"));
  const en = JSON.parse(read("public/locales/en.json"));
  for (const file of files) {
    const table = JSON.parse(read("public/locales/" + file));
    const keys = Object.keys(table);
    const safety = keys.filter((key) => key.startsWith("safety."));
    assert.deepEqual([...safety].sort(), [...SAFETY_KEYS].sort(), file);
    const first = keys.indexOf(safety[0]);
    assert.deepEqual(keys.slice(first, first + safety.length), safety, file + ": contiguous");
    for (const key of SAFETY_KEYS) assert.ok(String(table[key]).trim(), file + " " + key);
    assert.match(table["safety.linkWarningDomain"], /\{domain\}/, file);
    if (file !== "en.json") {
      const same = SAFETY_KEYS.filter((key) => table[key] === en[key]).length;
      assert.ok(same <= 2, file + ": " + same + " strings left in English");
    }
  }
});
