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

// AGPL-3.0 §13 (v5.21.0): a network user is offered the Corresponding Source
// of the RUNNING version. The worker stamps the shell with a source-url meta
// (SOURCE_URL when it is a valid https:// URL, else the repository tree at
// the deployed COMMIT_SHA); the footer link reads it and falls back to the
// repository URL. Anything that is not https:// never becomes an href.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { DEFAULT_SOURCE_URL, paintSourceLink, readSourceUrl, safeSourceUrl } from "../public/js/source-link.js";
import { DEFAULT_SOURCE_REPO, sourceUrl } from "../api/core/source-url.mjs";

const REPO = "https://github.com/Wempo-s-Silly-Projects/wempos-forum";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const shell = async (env) => (await worker.fetch(new Request("https://wempos-forum.com/", { headers: { Accept: "text/html" } }), env, {})).text();
const metaOf = (html) => /<meta name="source-url" content="([^"]*)">/.exec(html)?.[1] ?? null;

// ---- server: the stamped meta ---------------------------------------------

test("both sides default to the public repository", () => {
  assert.equal(DEFAULT_SOURCE_REPO, REPO);
  assert.equal(DEFAULT_SOURCE_URL, REPO);
});

test("the shell links the repository tree at the deployed commit", async () => {
  assert.equal(metaOf(await shell(makeEnv({ COMMIT_SHA: "abc1234" }))), REPO + "/tree/abc1234");
});

test("SOURCE_URL (https) overrides the commit link for self-hosters", async () => {
  const html = await shell(makeEnv({ SOURCE_URL: "https://git.example.org/me/my-forum", COMMIT_SHA: "abc1234" }));
  assert.equal(metaOf(html), "https://git.example.org/me/my-forum");
});

test("a non-https SOURCE_URL falls back to the commit link", async () => {
  for (const bad of ["javascript:alert(1)", "http://git.example.org/x", "data:text/html,hi", "//evil.example", "not a url", "  ", "https://user:pw@git.example.org/x"]) {
    assert.equal(sourceUrl({ SOURCE_URL: bad, COMMIT_SHA: "abc1234" }), REPO + "/tree/abc1234", bad);
  }
});

test("a SOURCE_URL with markup is attribute-escaped, never raw", async () => {
  const html = await shell(makeEnv({ SOURCE_URL: 'https://git.example.org/a"><script>x</script>', COMMIT_SHA: "abc1234" }));
  assert.equal(html.toLowerCase().includes("<script>x"), false);
  const meta = metaOf(html);
  assert.ok(meta && meta.startsWith("https://git.example.org/"), String(meta));
  assert.doesNotMatch(meta, /[<>"]/);
});

test("no SOURCE_URL and no usable COMMIT_SHA: no meta (the client falls back to the repo)", async () => {
  assert.equal(sourceUrl({}), "");
  assert.equal(sourceUrl({ COMMIT_SHA: "" }), "");
  assert.equal(sourceUrl({ COMMIT_SHA: "<b>main</b>" }), "");
  assert.equal(sourceUrl({ COMMIT_SHA: "../../evil" }), "");
  assert.equal(metaOf(await shell(makeEnv({ COMMIT_SHA: undefined }))), null);
});

// ---- client: the footer link ----------------------------------------------

function fakeShell(metaContent) {
  const root = new FakeNode("html");
  if (metaContent !== undefined) {
    const meta = new FakeNode("meta");
    meta.setAttribute("name", "source-url");
    meta.setAttribute("content", metaContent);
    root.appendChild(meta);
  }
  const link = new FakeNode("a");
  link.setAttribute("data-source-link", "");
  link.setAttribute("href", REPO);
  root.appendChild(link);
  const doc = makeFakeDocument({ querySelector: (selector) => root.querySelector(selector) });
  return { doc, link };
}

test("safeSourceUrl keeps https:// and refuses everything else", () => {
  assert.equal(safeSourceUrl("https://git.example.org/me/forum"), "https://git.example.org/me/forum");
  for (const bad of [undefined, null, "", "javascript:alert(1)", "http://x.example", "data:,x", "/relative", "https://u:p@x.example/"]) {
    assert.equal(safeSourceUrl(bad), REPO, String(bad));
  }
});

test("paintSourceLink points the footer link at the stamped source URL", () => {
  const { doc, link } = fakeShell(REPO + "/tree/abc1234");
  assert.equal(readSourceUrl(doc), REPO + "/tree/abc1234");
  paintSourceLink(doc);
  assert.equal(link.getAttribute("href"), REPO + "/tree/abc1234");
});

test("paintSourceLink falls back to the repository for a missing or unsafe meta", () => {
  for (const content of [undefined, "javascript:alert(1)", "http://x.example"]) {
    const { doc, link } = fakeShell(content);
    paintSourceLink(doc);
    assert.equal(link.getAttribute("href"), REPO, String(content));
  }
});

test("paintSourceLink is a no-op on a page without the footer link", () => {
  const doc = makeFakeDocument({ querySelector: () => null });
  assert.doesNotThrow(() => paintSourceLink(doc));
});

test("source-link.js builds nothing from markup and app.js paints it at boot", () => {
  const source = read("public/js/source-link.js");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(source, /setAttribute\("href"/);
  assert.match(read("public/js/app.js"), /import \{ paintSourceLink \} from "\.\/source-link\.js";/);
  assert.match(read("public/js/app.js"), /paintSourceLink\(document\)/);
});

test("index.html footer carries a translated Source code link with a repo fallback href", () => {
  const html = read("public/index.html");
  const footer = /<footer class="site-footer">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? "";
  assert.match(footer, /<a data-source-link data-i18n="shell\.sourceCode" href="https:\/\/github\.com\/Wempo-s-Silly-Projects\/wempos-forum">Source code<\/a>/);
});

test("shell.sourceCode exists in en and every locale", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 57);
  for (const name of files) {
    const table = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    assert.equal(typeof table["shell.sourceCode"], "string", name);
    assert.ok(table["shell.sourceCode"].trim().length > 0, name);
  }
});

test("SOURCE_URL is documented for self-hosters", () => {
  assert.match(read("wrangler.example.toml"), /^(# ?)?SOURCE_URL = ""/m);
  const doc = read("docs/self-hosting.md");
  assert.match(doc, /SOURCE_URL/);
  assert.match(doc, /if you modify the forum, point this at YOUR source/i);
});
