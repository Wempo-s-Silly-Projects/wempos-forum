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

// L2 library wave: Prism's command-line plugin (terminal sessions in code
// blocks), MiniSearch (search the saved posts on the page), NoSleep.js (a
// "Keep screen awake" toggle on threads) and Driver.js (a short tour from
// the newcomer welcome card). Each ships byte for byte, is licensed in
// REUSE.toml, loads same-origin only when used, and is exercised here with
// either the real library (MiniSearch, Prism in vm) or an injected fake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import MiniSearch from "../public/js/vendor/minisearch.js";
import {
  COMMAND_LINE_LANGUAGE, COMMAND_LINE_MAX_CHARS, COMMAND_PROMPT, commandLinePlan, lineRanges, needsCommandLine,
} from "../public/js/command-line.js";
import { CODE_HIGHLIGHT_MAX_CHARS, PRISM_COMMAND_LINE_SRC, PRISM_SRC, createCodeHighlighter } from "../public/js/code-highlight.js";
import { renderBodyBlocks } from "../public/js/render.js";
import { createSavedSearch, matchingIndexes, savedCards } from "../public/js/saved-search.js";
import { NOSLEEP_SRC, createKeepAwakeButton, releaseKeepAwake } from "../public/js/keep-awake.js";
import {
  DRIVER_SCRIPT_SRC, DRIVER_STYLE_HREF, TOUR_STEPS, createTourButton, escapeHtml, startTour, tourSteps,
} from "../public/js/newcomer-tour.js";
import { createNewcomerCard, WELCOME_CARD } from "../public/js/newcomer.js";
import { t } from "../public/js/i18n.js";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- vendoring

const VENDORED = [
  { file: "public/js/vendor/prism-command-line.min.js", sha256: "50c171acacc1a397b9fb19432c4b5b877ec7298cef27a606ed54857e4d0dc191",
    license: "MIT", holder: "PrismJS contributors" },
  { file: "public/js/vendor/minisearch.js", sha256: "0393b3ba253b809d5e55707c7b0875ef9b518a296a006c6739b28876e154edb3",
    license: "MIT", holder: "Luca Ongaro" },
  { file: "public/js/vendor/NoSleep.min.js", sha256: "887b763e53ecaeba7bdddcacb29f7ffaf9da8a3576c2cca7ea4a1ecd14ff731c",
    license: "MIT", holder: "Rich Tibbett" },
  { file: "public/js/vendor/driver.js.iife.js", sha256: "9ef0eb2b57694145f881c225e61c988df73c03da36f3b2b176de744c17cf1e0d",
    license: "MIT", holder: "Kamran Ahmed" },
  { file: "public/js/vendor/driver.css", sha256: "9b47907a54c7629054ff09e5fbb7bcd139d672f69efd39df47862f337a3f9a9e",
    license: "MIT", holder: "Kamran Ahmed" },
];

const reuseBlock = (file) => read("REUSE.toml").split("[[annotations]]").findLast((part) => part.includes(`"${file}"`)
  || (file.startsWith("public/js/vendor/prism") && part.includes('"public/js/vendor/**"')));

for (const { file, sha256, license, holder } of VENDORED) {
  test(`${file} is the approved upstream build, byte for byte`, () => {
    assert.equal(createHash("sha256").update(readFileSync(new URL(file, ROOT))).digest("hex"), sha256);
  });

  test(`${file} is annotated ${license} in REUSE.toml with exactly one licence line`, () => {
    const block = reuseBlock(file);
    assert.ok(block, `an annotations block covers ${file}`);
    assert.equal(block.match(/SPDX-License-Identifier/g).length, 1);
    assert.match(block, new RegExp(`SPDX-License-Identifier = "${license}"`));
    assert.match(block, new RegExp(`SPDX-FileCopyrightText = "[^"]*${holder}`));
    assert.match(block, /precedence = "override"/);
  });

  test(`${file} pulls in nothing (no bare or remote imports)`, () => {
    const source = read(file);
    assert.doesNotMatch(source, /\bimport\s*[\s{*(]|\brequire\(\s*["']/);
    assert.doesNotMatch(source, /https?:\/\/[^\s"'`)]*\.(?:m?js|css)["'`]/, "no remote script or stylesheet URL");
  });
}

test("the new vendor REUSE blocks come after the Prism wildcard block (last match wins)", () => {
  const reuse = read("REUSE.toml");
  const wildcard = reuse.indexOf('"public/js/vendor/**"');
  for (const { file } of VENDORED.filter((entry) => !entry.file.includes("prism"))) {
    assert.ok(reuse.indexOf(`"${file}"`) > wildcard, file);
  }
});

test("none of the four libraries is imported statically by app code (lazy only)", () => {
  for (const path of ["public/js/app.js", "public/js/render.js", "public/js/routes/feed.js", "public/js/routes/post.js",
    "public/js/newcomer.js", "public/js/saved-search.js", "public/js/keep-awake.js", "public/js/newcomer-tour.js"]) {
    const source = read(path);
    assert.doesNotMatch(source, /^import[^;]*vendor\/(?:minisearch|NoSleep|driver|prism-command-line)/m, path);
  }
});

// ---------------------------------------------------------------- command line

test("lineRanges folds runs into the plugin's data-output syntax", () => {
  assert.equal(lineRanges([]), "");
  assert.equal(lineRanges([2]), "2");
  assert.equal(lineRanges([2, 3, 5]), "2-3,5");
  assert.equal(lineRanges([1, 2, 3, 7, 8, 10]), "1-3,7-8,10");
});

test("commandLinePlan: $-lines are commands (prompt removed), the rest is output", () => {
  assert.deepEqual(commandLinePlan("console", "$ ls\na.txt\nb.txt\n$ pwd\n/home"), {
    code: "ls\na.txt\nb.txt\npwd\n/home", output: "2-3,5",
  });
  assert.deepEqual(commandLinePlan(" Shell-Session ", "$ echo hi"), { code: "echo hi", output: "" });
  assert.deepEqual(commandLinePlan("terminal", "$\nout"), { code: "\nout", output: "2" });
  assert.equal(COMMAND_PROMPT, "$");
  assert.equal(COMMAND_LINE_LANGUAGE, "language-bash");
});

test("commandLinePlan refuses other fences, sessions with no command and oversized blocks", () => {
  assert.equal(commandLinePlan("bash", "$ ls"), null);
  assert.equal(commandLinePlan("console", "just output\nno prompt"), null);
  assert.equal(commandLinePlan("console", "$ls"), null, "a prompt needs its space");
  assert.equal(commandLinePlan("console", "$ " + "x".repeat(COMMAND_LINE_MAX_CHARS)), null);
  assert.ok(commandLinePlan("console", "$ " + "x".repeat(COMMAND_LINE_MAX_CHARS - 2)), "the cap is inclusive");
  assert.equal(COMMAND_LINE_MAX_CHARS, CODE_HIGHLIGHT_MAX_CHARS, "mirrors the highlight cap");
});

const renderCode = (body) => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body }, document, article);
  const pre = findByClass(article, "post-codeblock");
  const code = Array.from(pre.children).find((node) => node.tagName?.toLowerCase() === "code");
  return { pre, code };
};

test("renderBodyBlocks draws a ```console session as a command-line block", () => {
  const { pre, code } = renderCode("```console\n$ ls\na.txt\n$ pwd\n```");
  assert.match(pre.className, /\bcommand-line\b/);
  assert.equal(pre.getAttribute("data-prompt"), "$");
  assert.equal(pre.getAttribute("data-output"), "2");
  assert.match(code.className, /\blanguage-bash\b/);
  assert.match(code.className, /\bno-whitespace-normalization\b/);
  assert.equal(code.textContent, "ls\na.txt\npwd");
});

test("a session without prompts, or with markup in it, stays literal text", () => {
  const plain = renderCode("```console\nno prompt here\n```");
  assert.doesNotMatch(plain.pre.className, /command-line/);
  const markup = renderCode("```console\n$ echo '<img src=x onerror=alert(1)>'\n<b>out</b>\n```");
  assert.equal(markup.code.textContent, "echo '<img src=x onerror=alert(1)>'\n<b>out</b>");
  assert.equal(markup.code.children.length, 0, "text only, no elements");
});

test("needsCommandLine looks at the <pre> around each code block", () => {
  const document = makeFakeDocument();
  const pre = document.createElement("pre");
  pre.className = "post-codeblock command-line";
  const code = document.createElement("code");
  pre.append(code);
  const other = document.createElement("code");
  document.createElement("pre").append(other);
  assert.equal(needsCommandLine([other]), false);
  assert.equal(needsCommandLine([other, code]), true);
  assert.equal(needsCommandLine(null), false);
});

function loaderHarness() {
  const appended = [];
  const head = new FakeNode("head");
  head.append = (...nodes) => { appended.push(...nodes); };
  const document = makeFakeDocument({ head });
  const highlighted = [];
  const highlighter = createCodeHighlighter(document, () => ({ highlightElement: (code) => highlighted.push(code) }));
  const fire = async (index, type) => {
    for (const listener of appended[index].listeners[type] ?? []) listener({});
    await tick();
  };
  return { appended, highlighted, highlighter, fire, document };
}

const commandCode = (document) => {
  const pre = document.createElement("pre");
  pre.className = "post-codeblock command-line";
  const code = document.createElement("code");
  pre.append(code);
  return code;
};

test("the command-line plugin loads after Prism, once, only for a command-line block", async () => {
  const { appended, highlighted, highlighter, fire, document } = loaderHarness();
  const plainCode = document.createElement("code");
  highlighter.highlight([plainCode]);
  await fire(0, "load");
  await fire(1, "load");
  assert.equal(appended.length, 2, "no plugin for an ordinary block");
  assert.deepEqual(highlighted, [plainCode]);
  const session = commandCode(document);
  highlighter.highlight([session]);
  await tick();
  assert.equal(appended.length, 3);
  assert.equal(appended[2].getAttribute("src"), PRISM_COMMAND_LINE_SRC);
  assert.equal(highlighted.length, 1, "not painted before the plugin has loaded");
  await fire(2, "load");
  assert.deepEqual(highlighted, [plainCode, session]);
  highlighter.highlight([commandCode(document)]);
  await tick();
  assert.equal(appended.length, 3, "the plugin is fetched once");
  assert.equal(PRISM_COMMAND_LINE_SRC, "/js/vendor/prism-command-line.min.js");
});

test("a failed plugin load still paints the session (as plain bash)", async () => {
  const { appended, highlighted, highlighter, fire, document } = loaderHarness();
  const session = commandCode(document);
  highlighter.highlight([session]);
  await fire(0, "load");
  await fire(1, "load");
  assert.equal(appended[1].getAttribute("src"), PRISM_SRC);
  await fire(2, "error");
  assert.deepEqual(highlighted, [session]);
});

test("the vendored plugin hooks into the vendored Prism build and encodes output (vm)", () => {
  const context = vm.createContext({});
  vm.runInContext(read("public/js/prism-config.js"), context);
  vm.runInContext(read("public/js/vendor/prism.js"), context);
  const before = (context.Prism.hooks.all["before-highlight"] ?? []).length;
  context.document = {};
  vm.runInContext(read("public/js/vendor/prism-command-line.min.js"), context);
  assert.ok(context.Prism.hooks.all["before-highlight"].length > before, "the plugin registered its hook");
  const plugin = read("public/js/vendor/prism-command-line.min.js");
  assert.match(plugin, /Prism\.util\.encode/, "output lines are HTML-encoded by the plugin");
});

// ---------------------------------------------------------------- saved search

test("matchingIndexes uses real MiniSearch: prefix, typo-tolerant, every word must match", () => {
  const docs = [
    { id: 0, text: "Building a birdhouse out of pallets" },
    { id: 1, text: "My cat knocked over the birdbath" },
    { id: 2, text: "Pallet wood coffee table" },
  ];
  assert.equal(matchingIndexes(MiniSearch, docs, "   "), null, "blank shows everything");
  assert.deepEqual([...matchingIndexes(MiniSearch, docs, "pallet")].sort(), [0, 2]);
  assert.deepEqual([...matchingIndexes(MiniSearch, docs, "bird")].sort(), [0, 1], "prefix");
  assert.deepEqual([...matchingIndexes(MiniSearch, docs, "birdhose")], [0], "one typo");
  assert.deepEqual([...matchingIndexes(MiniSearch, docs, "pallet table")], [2], "AND");
  assert.equal(matchingIndexes(MiniSearch, docs, "zebra").size, 0);
});

function savedPage(texts) {
  const document = makeFakeDocument();
  const main = document.createElement("main");
  const list = document.createElement("div");
  list.className = "post-list";
  for (const text of texts) {
    const card = document.createElement("article");
    card.className = "post-card";
    card.textContent = text;
    list.append(card);
  }
  main.append(list);
  return { document, main, list };
}

test("savedCards returns only the top-level cards of every post list", () => {
  const { document, main, list } = savedPage(["a", "b"]);
  const nested = document.createElement("article");
  nested.className = "post-card";
  list.children[0].append(nested);
  assert.equal(savedCards(main).length, 2);
});

test("createSavedSearch: labelled search box; MiniSearch loads on first input; non-matches hide", async () => {
  const { document, main } = savedPage(["Birdhouse build", "Coffee table", "Bird feeder"]);
  let loads = 0;
  const box = createSavedSearch(document, main, { loadMiniSearch: async () => { loads += 1; return MiniSearch; } });
  main.prepend(box);
  const input = box.querySelector("input");
  const label = box.querySelector("label");
  assert.equal(input.getAttribute("type"), "search");
  assert.equal(label.getAttribute("for"), input.id);
  assert.equal(label.textContent, t("feed.savedSearchLabel"));
  assert.equal(loads, 0, "nothing loads before the member types");
  input.value = "bird";
  input.dispatch("input", { target: input });
  await tick();
  const cards = savedCards(main);
  assert.deepEqual(cards.map((card) => card.hasAttribute("hidden")), [false, true, false]);
  const none = box.querySelector(".saved-search-none");
  assert.ok(none.hasAttribute("hidden"));
  input.value = "zebra";
  input.dispatch("input", { target: input });
  await tick();
  assert.ok(cards.every((card) => card.hasAttribute("hidden")));
  assert.equal(none.hasAttribute("hidden"), false);
  assert.equal(none.textContent, t("feed.savedSearchNone"));
  input.value = "";
  input.dispatch("input", { target: input });
  await tick();
  assert.ok(cards.every((card) => !card.hasAttribute("hidden")), "clearing shows every card again");
  assert.equal(loads, 1, "MiniSearch loads once");
});

test("cards added by Load more are searched too (the index rebuilds)", async () => {
  const { document, main, list } = savedPage(["Birdhouse build"]);
  const box = createSavedSearch(document, main, { loadMiniSearch: async () => MiniSearch });
  const input = box.querySelector("input");
  input.value = "coffee";
  input.dispatch("input", { target: input });
  await tick();
  const card = document.createElement("article");
  card.className = "post-card";
  card.textContent = "Coffee table";
  list.append(card);
  input.dispatch("input", { target: input });
  await tick();
  assert.equal(card.hasAttribute("hidden"), false);
});

test("a MiniSearch that fails to load leaves every card shown", async () => {
  const { document, main } = savedPage(["a", "b"]);
  const box = createSavedSearch(document, main, { loadMiniSearch: () => Promise.reject(new Error("offline")) });
  const input = box.querySelector("input");
  input.value = "zzz";
  input.dispatch("input", { target: input });
  await tick();
  assert.ok(savedCards(main).every((card) => !card.hasAttribute("hidden")));
});

// ---------------------------------------------------------------- keep awake

function fakeNoSleep(log, { fail = false } = {}) {
  return class {
    enable() { log.push("enable"); return fail ? Promise.reject(new Error("denied")) : Promise.resolve(); }
    disable() { log.push("disable"); }
  };
}

test("keep-awake toggle: off by default, NoSleep loads on the first press, a second press releases", async () => {
  const document = makeFakeDocument();
  const log = [];
  let loads = 0;
  const button = createKeepAwakeButton(document, { loadNoSleep: async () => { loads += 1; return fakeNoSleep(log); } });
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.textContent, t("post.keepAwake"));
  assert.equal(loads, 0);
  button.dispatch("click", {});
  await tick();
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.deepEqual(log, ["enable"]);
  button.dispatch("click", {});
  await tick();
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.deepEqual(log, ["enable", "disable"]);
  assert.equal(loads, 1);
});

test("keep-awake: a refused wake lock leaves the toggle off", async () => {
  const log = [];
  const button = createKeepAwakeButton(makeFakeDocument(), { loadNoSleep: async () => fakeNoSleep(log, { fail: true }) });
  button.dispatch("click", {});
  await tick();
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("releaseKeepAwake (every route change) lets the screen sleep again", async () => {
  const log = [];
  const button = createKeepAwakeButton(makeFakeDocument(), { loadNoSleep: async () => fakeNoSleep(log) });
  button.dispatch("click", {});
  await tick();
  releaseKeepAwake();
  assert.deepEqual(log, ["enable", "disable"]);
  assert.equal(button.getAttribute("aria-pressed"), "false");
  releaseKeepAwake();
  assert.deepEqual(log, ["enable", "disable"], "idempotent");
  assert.equal(NOSLEEP_SRC, "/js/vendor/NoSleep.min.js");
});

test("route-enhance releases the wake lock and post.js puts the toggle on the root card", () => {
  assert.match(read("public/js/route-enhance.js"), /releaseKeepAwake\(\)/);
  assert.match(read("public/js/routes/post.js"), /createKeepAwakeButton\(document\)/);
});

// ---------------------------------------------------------------- tour

test("escapeHtml neutralises markup before it reaches Driver.js (which uses innerHTML)", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('&')">`), "&lt;img src=x onerror=&quot;a(&#39;&amp;&#39;)&quot;&gt;");
});

test("tourSteps keeps only the steps whose element is on the page, text escaped", () => {
  const document = makeFakeDocument();
  const present = document.createElement("nav");
  document.querySelector = (selector) => (selector === TOUR_STEPS[0].selector ? present : null);
  const steps = tourSteps(document);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].element, present);
  assert.equal(steps[0].popover.description, escapeHtml(t(TOUR_STEPS[0].key)));
  assert.deepEqual(TOUR_STEPS.map((step) => step.selector), ["#account-actions", "#site-search", "#theme-toggle"]);
  const hostile = tourSteps(document, () => "<img src=x onerror=alert(1)>");
  assert.equal(hostile[0].popover.description, "&lt;img src=x onerror=alert(1)&gt;", "a translation is never markup");
});

function tourDocument() {
  const appended = [];
  const head = new FakeNode("head");
  head.append = (...nodes) => { appended.push(...nodes); };
  const document = makeFakeDocument({ head });
  const target = document.createElement("nav");
  document.querySelector = (selector) => {
    if (selector.startsWith("#")) return target;
    const href = /^link\[href="([^"]+)"\]$/.exec(selector)?.[1];
    return appended.find((node) => href && node.getAttribute("href") === href) ?? null;
  };
  return { document, appended };
}

test("startTour adds the stylesheet once, loads Driver.js and drives the translated steps", async () => {
  const { document, appended } = tourDocument();
  const configs = [];
  let drives = 0;
  const loadDriver = async () => (config) => { configs.push(config); return { drive: () => { drives += 1; } }; };
  await startTour(document, { loadDriver, win: { matchMedia: () => ({ matches: true }) } });
  await startTour(document, { loadDriver, win: { matchMedia: () => ({ matches: false }) } });
  const links = appended.filter((node) => node.tagName.toLowerCase() === "link");
  assert.equal(links.length, 1, "one stylesheet");
  assert.equal(links[0].getAttribute("href"), DRIVER_STYLE_HREF);
  assert.equal(links[0].getAttribute("rel"), "stylesheet");
  assert.equal(drives, 2);
  assert.equal(configs[0].steps.length, 3);
  assert.equal(configs[0].animate, false, "reduced motion: no animation");
  assert.equal(configs[1].animate, true);
  assert.equal(configs[0].nextBtnText, escapeHtml(t("common.next")));
  assert.equal(configs[0].prevBtnText, escapeHtml(t("common.back")));
  assert.equal(configs[0].doneBtnText, escapeHtml(t("common.done")));
  assert.equal(DRIVER_SCRIPT_SRC, "/js/vendor/driver.js.iife.js");
  assert.equal(DRIVER_STYLE_HREF, "/js/vendor/driver.css");
});

test("startTour with no tour targets on the page loads nothing", async () => {
  const document = makeFakeDocument();
  document.querySelector = () => null;
  let loads = 0;
  assert.equal(await startTour(document, { loadDriver: async () => { loads += 1; } }), null);
  assert.equal(loads, 0);
});

test("the welcome card offers the tour; the tips card does not (one tour, merged into newcomer.js)", () => {
  const document = makeFakeDocument();
  const welcome = createNewcomerCard(document, WELCOME_CARD, { id: 1, username: "ana" }, () => {});
  const button = findByClass(welcome, "newcomer-tour");
  assert.ok(button);
  assert.equal(button.textContent, t("newcomer.tourStart"));
  const tips = createNewcomerCard(document, "tips", { id: 1, username: "ana" }, () => {});
  assert.equal(findByClass(tips, "newcomer-tour"), null);
  assert.equal(createTourButton(document).getAttribute("type"), "button");
});

test("the vendored Driver.js build exposes driver.js.driver as a classic script (vm)", () => {
  const context = vm.createContext({});
  vm.runInContext(read("public/js/vendor/driver.js.iife.js"), context);
  assert.equal(typeof context.driver.js.driver, "function");
});
