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

// Wave 5.26 F2: a thin reading progress bar on thread pages. Width tracks
// scroll progress through the thread content (0-100%), updated once per
// animation frame from passive scroll/resize listeners; hidden when the
// content fits the viewport; no transition under reduced motion; removed
// (listeners included) on every route change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROGRESS_CLASS, PROGRESS_STILL_CLASS,
  readingProgress, startReadingProgress, stopReadingProgress,
} from "../public/js/reading-progress.js";
import { FakeNode, makeFakeDocument, countByClass } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// A window that records listeners (with options) and frame requests.
function fakeWindow({ innerHeight = 1000, reduced = false } = {}) {
  const listeners = {};
  const frames = new Map();
  const cancelled = [];
  let nextFrame = 1;
  return {
    innerHeight,
    listeners,
    frames,
    cancelled,
    matchMedia: (query) => ({ matches: reduced && query.includes("reduce") }),
    addEventListener(type, fn, options) { (listeners[type] ??= []).push({ fn, options }); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((entry) => entry.fn !== fn); },
    requestAnimationFrame(fn) { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { cancelled.push(id); frames.delete(id); },
    fire(type) { for (const { fn } of listeners[type] ?? []) fn({}); },
    runFrames() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); },
  };
}

function setup(rect, windowOptions) {
  const doc = makeFakeDocument({ body: new FakeNode("body") });
  const win = fakeWindow(windowOptions);
  const content = new FakeNode("main");
  content.rect = rect;
  content.getBoundingClientRect = () => content.rect;
  return { doc, win, content };
}

const bar = (doc) => doc.body.querySelector("div." + PROGRESS_CLASS);

test("readingProgress: 0 at the top, 50 halfway, 100 at the end, clamped; null when content fits", () => {
  assert.equal(readingProgress({ top: 0, height: 2000 }, 1000), 0);
  assert.equal(readingProgress({ top: 200, height: 2000 }, 1000), 0);
  assert.equal(readingProgress({ top: -500, height: 2000 }, 1000), 50);
  assert.equal(readingProgress({ top: -1000, height: 2000 }, 1000), 100);
  assert.equal(readingProgress({ top: -3000, height: 2000 }, 1000), 100);
  assert.equal(readingProgress({ top: 0, height: 800 }, 1000), null);
  assert.equal(readingProgress({ top: 0, height: 1000 }, 1000), null);
  assert.equal(readingProgress(null, 1000), null);
});

test("startReadingProgress: aria-hidden bar in body, passive scroll+resize, one frame per burst", () => {
  const { doc, win, content } = setup({ top: 0, height: 3000 });
  startReadingProgress(doc, win, content);
  try {
    const node = bar(doc);
    assert.ok(node, "bar appended to body");
    assert.equal(node.getAttribute("aria-hidden"), "true");
    assert.equal(node.getAttribute("role"), "none");
    assert.equal(node.hidden, false);
    assert.equal(node.style.width, "0%");
    for (const type of ["scroll", "resize"]) {
      assert.equal(win.listeners[type].length, 1, type);
      assert.equal(win.listeners[type][0].options?.passive, true, type + " passive");
    }
    content.rect = { top: -1000, height: 3000 };
    win.fire("scroll");
    win.fire("scroll");
    win.fire("resize");
    assert.equal(win.frames.size, 1, "updates batched into one animation frame");
    win.runFrames();
    assert.equal(node.style.width, "50%");
  } finally {
    stopReadingProgress();
  }
});

test("startReadingProgress: hidden while the content fits the viewport, shown once it grows", () => {
  const { doc, win, content } = setup({ top: 0, height: 600 });
  startReadingProgress(doc, win, content);
  try {
    assert.equal(bar(doc).hidden, true);
    content.rect = { top: 0, height: 4000 };
    win.fire("resize");
    win.runFrames();
    assert.equal(bar(doc).hidden, false);
  } finally {
    stopReadingProgress();
  }
});

test("stopReadingProgress removes the bar, both listeners and any pending frame", () => {
  const { doc, win, content } = setup({ top: 0, height: 3000 });
  startReadingProgress(doc, win, content);
  win.fire("scroll");
  assert.equal(win.frames.size, 1);
  stopReadingProgress();
  assert.equal(bar(doc), null);
  assert.equal(win.listeners.scroll.length, 0);
  assert.equal(win.listeners.resize.length, 0);
  assert.equal(win.cancelled.length, 1, "pending frame cancelled");
  stopReadingProgress(); // a second stop is a no-op
});

test("starting again (a re-render) never stacks bars or listeners", () => {
  const { doc, win, content } = setup({ top: 0, height: 3000 });
  startReadingProgress(doc, win, content);
  startReadingProgress(doc, win, content);
  try {
    assert.equal(countByClass(doc.body, PROGRESS_CLASS), 1);
    assert.equal(win.listeners.scroll.length, 1);
    assert.equal(win.listeners.resize.length, 1);
  } finally {
    stopReadingProgress();
  }
});

test("reduced motion adds the still class (no width transition)", () => {
  const still = setup({ top: 0, height: 3000 }, { reduced: true });
  startReadingProgress(still.doc, still.win, still.content);
  assert.ok(bar(still.doc).classList.contains(PROGRESS_STILL_CLASS));
  stopReadingProgress();
  const moving = setup({ top: 0, height: 3000 });
  startReadingProgress(moving.doc, moving.win, moving.content);
  assert.equal(bar(moving.doc).classList.contains(PROGRESS_STILL_CLASS), false);
  stopReadingProgress();
});

test("every route change stops the bar; the thread page starts it", () => {
  const app = read("public/js/app.js");
  assert.match(app, /import \{ stopReadingProgress \} from "\.\/reading-progress\.js"/);
  const renderRoute = app.slice(app.indexOf("async function renderRoute("), app.indexOf("main.replaceChildren();", app.indexOf("async function renderRoute(")));
  assert.match(renderRoute, /stopReadingProgress\(\);/);
  const post = read("public/js/routes/post.js");
  assert.match(post, /startReadingProgress\(document, window, main\)/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/reading-progress\.js">/);
});

test("CSS: theme variables, no transition under reduced motion, hidden in print", () => {
  const css = read("public/styles.css");
  const rule = css.slice(css.indexOf(".reading-progress {"), css.indexOf("}", css.indexOf(".reading-progress {")));
  assert.match(rule, /position:\s*fixed/);
  assert.match(rule, /background:\s*var\(--/);
  assert.match(css, /\.reading-progress-still\s*\{\s*transition:\s*none;?\s*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.reading-progress\s*\{\s*transition:\s*none;?\s*\}/);
  const print = css.slice(css.indexOf("@media print {"));
  assert.match(print, /\.reading-progress/);
});

test("reading-progress.js stores nothing and makes no request", () => {
  const source = read("public/js/reading-progress.js");
  assert.doesNotMatch(source, /\bfetch\s*\(|\bapi\(|localStorage|sessionStorage|innerHTML/);
});
