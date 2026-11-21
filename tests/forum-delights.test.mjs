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

// Wave 2026-11-21-7 F2 (thread-author chip) + F3 (read aloud): both
// client-only, built from data the post payload already carries; read aloud
// speaks only through on-device voices and only on an explicit click.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isThreadStarterReply, markThreadStarterReplies, threadStarterId,
} from "../public/js/thread-starter.js";
import {
  createReadAloud, pickLocalVoice, speakableText, stopReadAloud,
} from "../public/js/read-aloud.js";

import { FakeNode, makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const fakeDocument = makeFakeDocument();

// --- F2: thread-author chip ---------------------------------------------------

test("threadStarterId reads the root author id; removed accounts yield null", () => {
  assert.equal(threadStarterId({ author: { id: 7 } }), 7);
  assert.equal(threadStarterId({ author: { id: "12" } }), 12);
  assert.equal(threadStarterId({ author: null }), null);
  assert.equal(threadStarterId({ author: { id: "x" } }), null);
  assert.equal(threadStarterId(null), null);
});

test("isThreadStarterReply matches only replies by the thread starter", () => {
  assert.equal(isThreadStarterReply({ author: { id: 7 }, parent: { id: 1 } }, 7), true);
  assert.equal(isThreadStarterReply({ author: { id: 8 }, parent: { id: 1 } }, 7), false);
  assert.equal(isThreadStarterReply({ author: null, parent: { id: 1 } }, 7), false);
  assert.equal(isThreadStarterReply({ author: { id: 7 }, parent: { id: 1 } }, null), false);
});

test("markThreadStarterReplies chips the starter's replies once, with a hover hint", () => {
  const rows = new Map([["2", new FakeNode("div")], ["3", new FakeNode("div")]]);
  const container = {
    querySelector: (selector) => rows.get(/data-post-id="(\d+)"/.exec(selector)?.[1]) ?? null,
  };
  const replies = [
    { id: 2, author: { id: 7 }, parent: { id: 1 } },
    { id: 3, author: { id: 9 }, parent: { id: 1 } },
  ];
  markThreadStarterReplies(fakeDocument, container, replies, 7);
  markThreadStarterReplies(fakeDocument, container, replies, 7);
  assert.equal(countByClass(rows.get("2"), "role-badge-op"), 1, "chipped exactly once");
  assert.equal(countByClass(rows.get("3"), "role-badge-op"), 0);
  const chip = findByClass(rows.get("2"), "role-badge-op");
  assert.ok(chip.textContent.length > 0);
  assert.ok(chip.getAttribute("title"));
  // A missing container or starter is a harmless no-op.
  markThreadStarterReplies(fakeDocument, null, replies, 7);
  markThreadStarterReplies(fakeDocument, container, replies, null);
});

test("post.js chips the starter's replies on first paint, older pages, and sub-replies", () => {
  const source = read("public/js/routes/post.js");
  assert.match(source, /from "\.\.\/thread-starter\.js"/);
  assert.equal((source.match(/markThreadStarterReplies\(/g) || []).length, 3);
  assert.match(source, /dataset\.starterId/);
  assert.match(read("public/styles.css"), /\.role-badge-op\b/);
});

// --- F3: read aloud --------------------------------------------------------------

test("speakableText hides spoilers and quotes and drops markdown marks", () => {
  const text = speakableText("# Hi **all**\n> quoted words\nThe end is ||Bruce dies|| ok\n- item `x`");
  assert.ok(!text.includes("Bruce"), "spoilers are never read out");
  assert.ok(!text.includes("quoted"), "quoted text from others is skipped");
  assert.ok(!/[#*`>]/.test(text));
  assert.match(text, /Hi all/);
  assert.match(text, /item x/);
  assert.equal(speakableText(null), "");
  assert.ok(speakableText("a".repeat(5000)).length <= 1200);
});

test("pickLocalVoice only ever returns on-device voices, preferring the language", () => {
  const voices = [
    { name: "cloud-fr", lang: "fr-FR", localService: false },
    { name: "local-en", lang: "en-US", localService: true, default: true },
    { name: "local-fr", lang: "fr-CA", localService: true },
  ];
  assert.equal(pickLocalVoice(voices, "fr").name, "local-fr");
  assert.equal(pickLocalVoice(voices, "en-US").name, "local-en");
  assert.equal(pickLocalVoice(voices, "ja").name, "local-en", "falls back to the default local voice");
  assert.equal(pickLocalVoice([{ name: "cloud", lang: "en", localService: false }], "en"), null);
  assert.equal(pickLocalVoice(undefined, "en"), null);
});

function fakeSynth(voices) {
  const synth = {
    spoken: [],
    cancelled: 0,
    speaking: false,
    getVoices: () => voices,
    addEventListener() {},
    removeEventListener() {},
    speak(utterance) { synth.spoken.push(utterance); synth.speaking = true; },
    cancel() {
      synth.cancelled += 1;
      synth.speaking = false;
      for (const utterance of synth.spoken) utterance.onend?.();
    },
  };
  return synth;
}
class FakeUtterance { constructor(text) { this.text = text; } }

test("createReadAloud returns null where speech is unavailable", () => {
  assert.equal(createReadAloud(fakeDocument, () => "hi", { synth: null, Utterance: FakeUtterance }), null);
  assert.equal(createReadAloud(fakeDocument, () => "hi", { synth: fakeSynth([]), Utterance: null }), null);
});

test("read aloud toggles aria-pressed, speaks with a local voice, and stops on a second click", async () => {
  const synth = fakeSynth([{ name: "local-en", lang: "en-US", localService: true }]);
  const wrap = createReadAloud(fakeDocument, () => "Hello ||secret|| there", {
    synth, Utterance: FakeUtterance, lang: "en",
  });
  const button = findByClass(wrap, "read-aloud-button");
  const status = findByClass(wrap, "read-aloud-status");
  assert.equal(button.type, "button");
  assert.ok(button.getAttribute("aria-label"));
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(status.getAttribute("role"), "status", "the live region exists before it is used");
  await button.fire("click");
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].voice.name, "local-en");
  assert.ok(!synth.spoken[0].text.includes("secret"));
  assert.equal(button.getAttribute("aria-pressed"), "true");
  await button.fire("click");
  assert.ok(synth.cancelled >= 1);
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("read aloud refuses network voices and says so in the status", async () => {
  const synth = fakeSynth([{ name: "cloud", lang: "en-US", localService: false }]);
  const wrap = createReadAloud(fakeDocument, () => "Hello", {
    synth, Utterance: FakeUtterance, lang: "en", voiceWaitMs: 0,
  });
  await findByClass(wrap, "read-aloud-button").fire("click");
  assert.equal(synth.spoken.length, 0, "nothing is sent to a network voice");
  assert.ok(findByClass(wrap, "read-aloud-status").textContent.length > 0);
  assert.equal(findByClass(wrap, "read-aloud-button").getAttribute("aria-pressed"), "false");
});

test("stopReadAloud cancels speech and is safe without a synth", () => {
  const synth = fakeSynth([]);
  stopReadAloud(synth);
  assert.equal(synth.cancelled, 1);
  stopReadAloud(null);
});

test("render.js mounts read aloud on cards and app.js stops it on navigation", () => {
  const render = read("public/js/render.js");
  assert.match(render, /from "\.\/read-aloud\.js"/);
  assert.match(render, /createReadAloud\(document, \(\) => article\.postBody\)/);
  const app = read("public/js/app.js");
  assert.match(app, /from "\.\/read-aloud\.js"/);
  assert.match(app, /stopReadAloud\(\)/);
});
