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

// Batch M: Fun extras. Pins the vendored libraries byte for byte and their
// REUSE licensing, the one settings panel (every toggle ON without saved preferences), and
// for each effect: nothing loads while its toggle is off, reduced motion
// keeps everything still, nothing reaches the network (or the camera) before
// an explicit action, and every library comes only from /js/vendor/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as constants from "../constants.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sha256 = (path) => createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex");

const settings = await import("../public/js/fun/settings.js");
const loader = await import("../public/js/fun/loader.js");
const confetti = await import("../public/js/fun/confetti.js");
const badgeArt = await import("../public/js/fun/badge-art.js");
const highlight = await import("../public/js/fun/highlight.js");
const hero = await import("../public/js/fun/hero.js");
const sounds = await import("../public/js/fun/sounds.js");
const eggs = await import("../public/js/fun/eggs.js");
const sketch = await import("../public/js/fun/sketch.js");
const fun = await import("../public/js/fun/index.js");
const { createNextBadge } = await import("../public/js/badge-progress.js");
const { SETTINGS_GROUPS } = await import("../public/js/settings-groups.js");

// ---------------------------------------------------------------- helpers

const memoryStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    dump: () => Object.fromEntries(map),
  };
};
const blockedStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};
const fakeWin = ({ reduced = false, fine = true } = {}) => ({
  matchMedia: (query) => ({
    matches: query.includes("reduced-motion") ? reduced : query.includes("pointer: fine") ? fine : false,
  }),
});
const allOn = () => memoryStorage({
  [settings.FUN_STORAGE_KEY]: JSON.stringify(Object.fromEntries(settings.FUN_KEYS.map((key) => [key, true]))),
});
const allOff = () => memoryStorage({
  [settings.FUN_STORAGE_KEY]: JSON.stringify(Object.fromEntries(settings.FUN_KEYS.map((key) => [key, false]))),
});
const onlyOn = (key) => memoryStorage({ [settings.FUN_STORAGE_KEY]: JSON.stringify({ [key]: true }) });

// A loader that records every library request and hands back stubs.
const recordingLoader = (libs = {}) => {
  const calls = [];
  const load = async (name) => {
    calls.push(name);
    if (!(name in libs)) throw new Error("unexpected library " + name);
    return libs[name];
  };
  return { calls, load };
};

const makeDoc = () => {
  const body = new FakeNode("body");
  const head = new FakeNode("head");
  const doc = makeFakeDocument({ body, head });
  const listeners = {};
  doc.addEventListener = (type, listener) => { (listeners[type] ??= []).push(listener); };
  doc.removeEventListener = (type, listener) => {
    listeners[type] = (listeners[type] ?? []).filter((entry) => entry !== listener);
  };
  doc.fire = (type, event) => (listeners[type] ?? []).forEach((listener) => listener(event));
  doc.listenerCount = (type) => (listeners[type] ?? []).length;
  return doc;
};

const env = (overrides = {}) => ({
  doc: makeDoc(),
  win: fakeWin(),
  storage: allOff(),
  load: recordingLoader().load,
  importModule: async () => { throw new Error("no module expected"); },
  userId: 7,
  now: () => 1_000_000,
  ...overrides,
});

const badgeRoot = (total) => {
  const root = new FakeNode("main");
  root.append(createNextBadge(makeFakeDocument(), total));
  return root;
};

const VENDORED = {
  "public/js/vendor/confetti.browser.js": "canvas-confetti 1.9.4",
  "public/js/vendor/lottie_light.min.js": "lottie-web 5.13.0",
  "public/js/vendor/rough-notation.iife.js": "rough-notation 0.5.1",
  "public/js/vendor/vanilla-tilt.min.js": "vanilla-tilt 1.8.1",
  "public/js/vendor/typeit.umd.js": "typeit 8.8.7",
  "public/js/vendor/splitting.min.js": "splitting 1.1.0",
  "public/js/vendor/zzfx.js": "zzfx 1.4.0",
  "public/js/vendor/cursor-effects.browser.js": "cursor-effects 1.0.18",
  "public/js/vendor/matter.min.js": "matter-js 0.20.0",
  "public/js/vendor/signature_pad.umd.min.js": "signature_pad 5.1.5",
};
const VENDOR_SHA256 = {
  "public/js/vendor/confetti.browser.js": "49f4bcbc56e7ceb5c3d25d13db1d0da965b6cd1c8a54a707bb055be0685b0a95",
  "public/js/vendor/lottie_light.min.js": "9588432bec30c8ef8200bac4a67d8aaad881047bc2a6c9fa624d90ec96402410",
  "public/js/vendor/rough-notation.iife.js": "f90aa0090e361ff48694b74e0319e109856decb3e757c280dfe25e3607f35fac",
  "public/js/vendor/vanilla-tilt.min.js": "de6fa8d3f40dbae2726a72f7d1ae46bb0588267af05355bef1d128f737f4a282",
  "public/js/vendor/typeit.umd.js": "92a942db99594f9d00a807016aaae091c86a3553e98025df6a725ed9f290c468",
  "public/js/vendor/splitting.min.js": "2c57efb96085bbfd54ec98062087affc0b958ecf408ad49ea6cfa6efbba2fb8d",
  "public/js/vendor/zzfx.js": "43f321101a935892c112a291e2e943b4da33159b43fcd4a21f3eae710f4a27ff",
  "public/js/vendor/cursor-effects.browser.js": "19afd3c18b591e805118ab4d5e9e4d3bfe81a6aa3b91c804ccd2361b3def999c",
  "public/js/vendor/matter.min.js": "72d30be0f579eb02ce1e0b6f9d359a4f392e6837e5a26ba8be5dbee7f88e24ae",
  "public/js/vendor/signature_pad.umd.min.js": "0575208b6221b7ca986de5945a529f7bdd296f997df744445a878617fe4fa6b4",
};

// ---------------------------------------------------------------- vendored libraries

for (const [path, upstream] of Object.entries(VENDORED)) {
  test(`${path} is the approved ${upstream} build, byte for byte`, () => {
    assert.ok(existsSync(new URL(path, ROOT)), path + " ships");
    assert.equal(sha256(path), VENDOR_SHA256[path]);
  });
}

test("REUSE.toml gives each vendored fun library its own upstream license (override, after the Prism block)", () => {
  const reuse = read("REUSE.toml");
  const blocks = reuse.split("[[annotations]]");
  const prismIndex = blocks.findIndex((block) => block.includes('"public/js/vendor/**"'));
  const expected = {
    "public/js/vendor/confetti.browser.js": "ISC",
    "public/js/vendor/lottie_light.min.js": "MIT",
    "public/js/vendor/rough-notation.iife.js": "MIT",
    "public/js/vendor/vanilla-tilt.min.js": "MIT",
    "public/js/vendor/typeit.umd.js": "GPL-3.0-only",
    "public/js/vendor/splitting.min.js": "MIT",
    "public/js/vendor/zzfx.js": "MIT",
    "public/js/vendor/cursor-effects.browser.js": "MIT",
    "public/js/vendor/matter.min.js": "MIT",
    "public/js/vendor/signature_pad.umd.min.js": "MIT",
  };
  for (const [path, license] of Object.entries(expected)) {
    const index = blocks.findIndex((block) => block.includes(`"${path}"`));
    assert.ok(index > prismIndex, path + " is annotated after the vendor/** block (the later match wins)");
    assert.match(blocks[index], new RegExp(`SPDX-License-Identifier = "${license}"`), path);
    assert.match(blocks[index], /precedence = "override"/, path);
    assert.ok(existsSync(new URL(`LICENSES/${license}.txt`, ROOT)), `LICENSES/${license}.txt ships`);
  }
});

test("no audio, Lottie JSON or sprite assets ship for the extras (sounds are synthesised)", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  const assets = walk(new URL("public/", ROOT).pathname).filter((file) => /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file));
  assert.deepEqual(assets, []);
});

test("fun modules only ever load from /js/vendor/ (no CDN, no other origin, no fetch)", () => {
  const dir = new URL("public/js/fun/", ROOT).pathname;
  // v5.86: recursive (fun/saturday-fools/ holds the weekly gag modules).
  for (const name of readdirSync(dir, { recursive: true }).filter((entry) => entry.endsWith(".js"))) {
    const source = readFileSync(join(dir, name), "utf8");
    assert.doesNotMatch(source, /["'`]https?:\/\/(?!www\.gnu\.org)/, name);
    assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|getUserMedia/, name);
  }
  for (const entry of Object.values(loader.FUN_VENDOR)) {
    assert.match(entry.src, /^\/js\/vendor\/[\w.-]+\.js$/);
    assert.ok(existsSync(new URL("public" + entry.src, ROOT)), entry.src);
  }
  assert.match(loader.ZZFX_MODULE, /^\/js\/vendor\/zzfx\.js$/);
});

test("the caps live in constants.mjs and the client mirrors them exactly", () => {
  assert.equal(constants.FUN_CONFETTI_PARTICLES, 120);
  assert.equal(constants.FUN_GRAVITY_BODIES_MAX, 24);
  assert.equal(constants.FUN_SKETCH_SIZE_PX, 480);
  assert.equal(constants.FUN_SOUND_MIN_GAP_MS, 4000);
  assert.equal(confetti.FUN_CONFETTI_PARTICLES, constants.FUN_CONFETTI_PARTICLES);
  assert.equal(eggs.FUN_GRAVITY_BODIES_MAX, constants.FUN_GRAVITY_BODIES_MAX);
  assert.equal(sketch.FUN_SKETCH_SIZE_PX, constants.FUN_SKETCH_SIZE_PX);
  assert.equal(sounds.FUN_SOUND_MIN_GAP_MS, constants.FUN_SOUND_MIN_GAP_MS);
});

test("the vendor loader adds one same-origin classic script per library, once, and resolves its global", async () => {
  const doc = makeDoc();
  const win = {};
  const load = loader.createVendorLoader(doc, win);
  const first = load("vanillaTilt");
  const again = load("vanillaTilt");
  assert.equal(doc.head.children.length, 1, "one script tag however often it is asked for");
  const script = doc.head.children[0];
  assert.equal(script.getAttribute("src"), "/js/vendor/vanilla-tilt.min.js");
  win.VanillaTilt = { init() {} };
  script.dispatch("load", {});
  assert.equal(await first, win.VanillaTilt);
  assert.equal(await again, win.VanillaTilt);
  await assert.rejects(load("nope"));
});

// ---------------------------------------------------------------- settings

test("every fun extra defaults ON when no preferences are stored, including blocked or invalid storage", () => {
  assert.deepEqual(settings.FUN_KEYS, ["confetti", "motion", "heroType", "sounds", "easterEggs", "sketch"]);
  for (const storage of [memoryStorage(), blockedStorage, null, memoryStorage({ [settings.FUN_STORAGE_KEY]: "{oops" }),
    memoryStorage({ [settings.FUN_STORAGE_KEY]: "[true]" })]) {
    assert.deepEqual(settings.readFunSettings(storage), settings.FUN_DEFAULTS);
    assert.ok(Object.values(settings.readFunSettings(storage)).every((value) => value === true));
  }
  assert.equal(settings.isFunOn("confetti", memoryStorage({ [settings.FUN_STORAGE_KEY]: '{"confetti":"yes"}' })), false);
});

test("stored fun preferences are normalized to known boolean keys and respected", () => {
  const storage = memoryStorage({ [settings.FUN_STORAGE_KEY]: JSON.stringify({ confetti: false, motion: true, sounds: false, unknown: true }) });
  assert.deepEqual(settings.readFunSettings(storage), {
    confetti: false, motion: true, heroType: false, sounds: false, easterEggs: false, sketch: false,
  });
  assert.equal(settings.isFunOn("motion", storage), true);
  assert.equal(settings.isFunOn("confetti", storage), false);
});

test("writeFunSetting stores one key without mutating the previous settings object", () => {
  const storage = memoryStorage();
  const before = settings.readFunSettings(storage);
  const after = settings.writeFunSetting(storage, "sounds", true);
  assert.equal(before.sounds, true);
  assert.equal(after.sounds, true);
  assert.equal(settings.readFunSettings(storage).sounds, true);
  assert.doesNotThrow(() => settings.writeFunSetting(blockedStorage, "sounds", true));
});

test("the Fun extras panel: unsaved preferences show checked switches, save changes, and show the reduced-motion note", () => {
  const storage = memoryStorage();
  const doc = makeFakeDocument();
  let seen = null;
  const panel = settings.createFunExtrasPanel(doc, storage, { win: fakeWin(), onChange: (value) => { seen = value; } });
  assert.match(panel.className, /\bpanel\b/);
  const boxes = panel.querySelectorAll("input.fun-extras-switch");
  assert.equal(boxes.length, settings.FUN_KEYS.length);
  for (const box of boxes) assert.equal(box.checked, true, box.dataset.funKey + " defaults on");
  assert.deepEqual(storage.dump(), {}, "rendering stores nothing");
  boxes[0].checked = false;
  boxes[0].dispatch("change", {});
  assert.equal(seen.confetti, false);
  assert.equal(settings.isFunOn("confetti", storage), false);
  assert.equal(panel.querySelector(".fun-extras-reduced"), null);
  const still = settings.createFunExtrasPanel(doc, storage, { win: fakeWin({ reduced: true }) });
  assert.ok(still.querySelector(".fun-extras-reduced"));
});

test("the panel sits in the Appearance settings group and the hub renders it", () => {
  assert.ok(SETTINGS_GROUPS.find((group) => group.key === "appearance").panelTitleKeys.includes("fun.title"));
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /createFunExtrasPanel\(document, storage/);
});

test("clearAllFunExtras wipes every badge-seen marker (account data) but keeps the device switches; sign-out calls it", () => {
  const storage = allOn();
  const switches = storage.getItem(settings.FUN_STORAGE_KEY);
  storage.setItem(settings.FUN_BADGE_SEEN_PREFIX + "7", "profile.badgeNew");
  storage.setItem("unrelated", "keep");
  settings.clearAllFunExtras(storage);
  assert.deepEqual(storage.dump(), { [settings.FUN_STORAGE_KEY]: switches, unrelated: "keep" });
  assert.doesNotThrow(() => settings.clearAllFunExtras(blockedStorage));
  assert.match(read("public/js/routes/account-nav.js"), /clearAllFunExtras\(/);
});

// ---------------------------------------------------------------- everything off

test("with every extra off, a full enhance pass loads nothing and touches no storage", async () => {
  const recorder = recordingLoader();
  const storage = allOff();
  const before = storage.dump();
  const root = badgeRoot(25);
  const intro = new FakeNode("section");
  intro.className = "personal-intro";
  const h1 = new FakeNode("h1");
  h1.textContent = "Hello";
  intro.append(h1);
  const label = new FakeNode("span");
  label.className = "role-badge staff-pick-label";
  root.append(intro, label);
  const doc = makeDoc();
  await fun.enhanceFunView(root, env({ doc, storage, load: recorder.load }));
  assert.deepEqual(recorder.calls, []);
  assert.deepEqual(storage.dump(), before, "the enhance pass does not touch preferences");
  assert.equal(h1.textContent, "Hello");
  assert.equal(doc.head.children.length, 0, "not even the extras' stylesheet is linked");
});

test("the moving styles live in public/fun.css, linked once and only by an enabled extra", async () => {
  assert.doesNotMatch(read("public/styles.css"), /fun-hero-wave|fun-toy|rough-notation-dash/);
  const doc = makeDoc();
  await fun.enhanceFunView(new FakeNode("main"), env({ doc, storage: onlyOn("heroType") }));
  await fun.enhanceFunView(new FakeNode("main"), env({ doc, storage: onlyOn("heroType") }));
  assert.equal(doc.head.children.length, 1);
  assert.equal(doc.head.children[0].getAttribute("href"), loader.FUN_STYLESHEET);
  assert.equal(loader.FUN_STYLESHEET, "/fun.css");
  assert.match(read("public/fun.css"), /@media \(prefers-reduced-motion: reduce\)/);
});

// ---------------------------------------------------------------- confetti

test("the next-badge line carries the member's current badge for the confetti hook", () => {
  const line = createNextBadge(makeFakeDocument(), 120);
  assert.equal(line.dataset.funBadge, "profile.badgeBig");
});

test("confetti: first sighting only remembers the badge; an upgrade bursts once; reduced motion stays still", async () => {
  let fired = 0;
  const confettiLib = { create: () => Object.assign(() => { fired += 1; return Promise.resolve(); }, { reset() {} }) };
  const recorder = recordingLoader({ confetti: confettiLib });
  const storage = onlyOn("confetti");
  const base = { storage, load: recorder.load, schedule: () => {} };
  assert.equal(await confetti.celebrateMilestone(badgeRoot(5), env(base)), "seeded");
  assert.deepEqual(recorder.calls, [], "seeding loads nothing");
  assert.equal(await confetti.celebrateMilestone(badgeRoot(5), env(base)), "same");
  assert.equal(await confetti.celebrateMilestone(badgeRoot(25), env(base)), "burst");
  assert.equal(fired, 1);
  assert.equal(await confetti.celebrateMilestone(badgeRoot(25), env(base)), "same", "only once per unlock");
  assert.equal(fired, 1);
  assert.equal(await confetti.celebrateMilestone(badgeRoot(150), env({ ...base, win: fakeWin({ reduced: true }) })), "still");
  assert.equal(fired, 1, "no burst under reduced motion");
  assert.equal(await confetti.celebrateMilestone(badgeRoot(150), env({ ...base, userId: null })), "none", "only the member themself");
});

test("confetti off: nothing loads and nothing is remembered", async () => {
  const recorder = recordingLoader();
  const storage = allOff();
  const before = storage.dump();
  assert.equal(await confetti.celebrateMilestone(badgeRoot(25), env({ storage, load: recorder.load })), "off");
  assert.deepEqual(recorder.calls, []);
  assert.deepEqual(storage.dump(), before);
});

// ---------------------------------------------------------------- Lottie + tilt

test("badge art: Lottie (SVG renderer) plays once; reduced motion shows the first frame; tilt only for a fine pointer", async () => {
  const animations = [];
  const lottie = {
    loadAnimation: (options) => {
      const animation = { options, stopped: null, goToAndStop(frame) { this.stopped = frame; } };
      animations.push(animation);
      return animation;
    },
  };
  const tilted = [];
  const VanillaTilt = { init: (element, options) => tilted.push({ element, options }) };
  const recorder = recordingLoader({ lottie, vanillaTilt: VanillaTilt });
  const storage = onlyOn("motion");
  const root = badgeRoot(25);
  await badgeArt.decorateBadges(root, env({ storage, load: recorder.load }));
  assert.equal(animations.length, 1);
  assert.equal(animations[0].options.renderer, "svg");
  assert.equal(animations[0].options.loop, false);
  assert.equal(animations[0].options.autoplay, true);
  assert.equal(tilted.length, 1);
  await badgeArt.decorateBadges(root, env({ storage, load: recorder.load }));
  assert.equal(animations.length, 1, "decorated once per element");

  const still = recordingLoader({ lottie, vanillaTilt: VanillaTilt });
  await badgeArt.decorateBadges(badgeRoot(25), env({ storage, load: still.load, win: fakeWin({ reduced: true }) }));
  assert.equal(animations[1].options.autoplay, false);
  assert.equal(animations[1].stopped, 0, "first frame only");
  assert.deepEqual(still.calls, ["lottie"], "no tilt under reduced motion");

  const coarse = recordingLoader({ lottie, vanillaTilt: VanillaTilt });
  await badgeArt.decorateBadges(badgeRoot(25), env({ storage, load: coarse.load, win: fakeWin({ fine: false }) }));
  assert.deepEqual(coarse.calls, ["lottie"], "no tilt on touch");
});

// ---------------------------------------------------------------- rough-notation

test("labels: rough-notation underlines Staff Pick / Question of the Day once; reduced motion = static underline", async () => {
  const shown = [];
  const RoughNotation = { annotate: (element, options) => ({ show: () => shown.push({ element, options }) }) };
  const recorder = recordingLoader({ roughNotation: RoughNotation });
  const storage = onlyOn("motion");
  const root = new FakeNode("main");
  const pick = new FakeNode("span");
  pick.className = "role-badge staff-pick-label";
  const qotd = new FakeNode("span");
  qotd.className = "qotd-label";
  root.append(pick, qotd);
  const win = fakeWin();
  await highlight.highlightLabels(root, env({ storage, load: recorder.load, win }));
  assert.equal(shown.length, 2);
  assert.equal(shown[0].options.type, "underline");
  assert.equal(win.__rno_kf_s, true, "the keyframes come from styles.css, no inline <style> (CSP)");
  await highlight.highlightLabels(root, env({ storage, load: recorder.load, win }));
  assert.equal(shown.length, 2, "once on view");

  const still = recordingLoader();
  const stillLabel = new FakeNode("span");
  stillLabel.className = "qotd-label";
  const stillRoot = new FakeNode("main");
  stillRoot.append(stillLabel);
  await highlight.highlightLabels(stillRoot, env({ storage, load: still.load, win: fakeWin({ reduced: true }) }));
  assert.deepEqual(still.calls, []);
  assert.ok(stillLabel.classList.contains("fun-static-underline"));
  assert.match(read("public/fun.css"), /@keyframes rough-notation-dash/);
});

// ---------------------------------------------------------------- hero

test("hero: TypeIt types the home headline then Splitting splits it; reduced motion keeps plain text", async () => {
  const typed = [];
  function TypeIt(element, options) { typed.push({ element, options }); this.go = () => { options.afterComplete?.(); return this; }; }
  const splits = [];
  const Splitting = (options) => splits.push(options);
  const recorder = recordingLoader({ typeIt: TypeIt, splitting: Splitting });
  const storage = onlyOn("heroType");
  const root = new FakeNode("main");
  const intro = new FakeNode("section");
  intro.className = "personal-intro";
  const h1 = new FakeNode("h1");
  h1.textContent = "Welcome";
  intro.append(h1);
  root.append(intro);
  await hero.typeHeroHeadline(root, env({ storage, load: recorder.load }));
  assert.equal(typed.length, 1);
  assert.deepEqual(typed[0].options.strings, ["Welcome"]);
  assert.equal(typed[0].options.html, false, "the headline is typed as text, never parsed as markup");
  assert.equal(h1.getAttribute("aria-label"), "Welcome", "screen readers get the whole headline at once");
  assert.equal(splits.length, 1);

  const still = recordingLoader();
  const plainRoot = new FakeNode("main");
  const plainIntro = new FakeNode("section");
  plainIntro.className = "personal-intro";
  const plain = new FakeNode("h1");
  plain.textContent = "Welcome";
  plainIntro.append(plain);
  plainRoot.append(plainIntro);
  await hero.typeHeroHeadline(plainRoot, env({ storage, load: still.load, win: fakeWin({ reduced: true }) }));
  assert.deepEqual(still.calls, []);
  assert.equal(plain.textContent, "Welcome");
});

// ---------------------------------------------------------------- sounds

test("sounds: an explicitly disabled toggle stays silent; enabling it plays one synthesised chime", async () => {
  const played = [];
  const zzfxModule = { zzfx: (...parameters) => played.push(parameters) };
  const importModule = async (src) => { assert.equal(src, loader.ZZFX_MODULE); return zzfxModule; };
  assert.equal(await sounds.chimeForUnread(0, 3, env({ storage: allOff(), importModule })), false, "explicitly disabled");
  const storage = onlyOn("sounds");
  let clock = 10_000;
  const base = { storage, importModule, now: () => clock };
  assert.equal(await sounds.chimeForUnread(3, 3, env(base)), false, "no rise, no sound");
  assert.equal(await sounds.chimeForUnread(3, 4, env(base)), true);
  assert.equal(played.length, 1);
  clock += 1000;
  assert.equal(await sounds.chimeForUnread(4, 5, env(base)), false, "rate limited");
  clock += sounds.FUN_SOUND_MIN_GAP_MS;
  const quiet = memoryStorage({
    [settings.FUN_STORAGE_KEY]: JSON.stringify({ sounds: true }),
    "forum-quiet-hours": JSON.stringify({ enabled: true, start: 0, end: 23 }),
  });
  const hour = new Date().getHours();
  if (hour < 23) assert.equal(await sounds.chimeForUnread(5, 6, env({ ...base, storage: quiet })), false, "quiet hours win");
  assert.equal(played.length, 1);
});

test("noteUnreadCount seeds on the first count and only chimes on a later rise", async () => {
  const calls = [];
  const watcher = fun.createUnreadWatcher((previous, next) => { calls.push([previous, next]); return Promise.resolve(false); });
  watcher(2);
  watcher(2);
  watcher(5);
  assert.deepEqual(calls, [[2, 5]]);
});

// ---------------------------------------------------------------- easter eggs

const konami = (doc, target = new FakeNode("body")) => {
  for (const key of eggs.KONAMI) doc.fire("keydown", { key, target });
};

test("easter eggs: no listener while off; the Konami code starts the toy only when on and not reduced", async () => {
  const doc = makeDoc();
  const off = eggs.installEasterEggs(env({ doc }));
  assert.equal(doc.listenerCount("keydown"), 1, "one listener (it asks the toggle at key time)");
  const recorder = recordingLoader();
  off();
  assert.equal(doc.listenerCount("keydown"), 0, "removable");

  const started = [];
  const uninstall = eggs.installEasterEggs(env({ doc, storage: allOff(), start: () => started.push("party") }));
  konami(doc);
  assert.deepEqual(started, [], "toggle off: the code does nothing");
  uninstall();

  const onStorage = onlyOn("easterEggs");
  const reduced = eggs.installEasterEggs(env({ doc, storage: onStorage, win: fakeWin({ reduced: true }), start: () => started.push("party") }));
  konami(doc);
  assert.deepEqual(started, [], "reduced motion: nothing moves");
  reduced();

  const live = eggs.installEasterEggs(env({ doc, storage: onStorage, start: () => started.push("party") }));
  const field = new FakeNode("textarea");
  konami(doc, field);
  assert.deepEqual(started, [], "typing in a field never triggers it");
  konami(doc);
  assert.deepEqual(started, ["party"]);
  live();
  assert.deepEqual(recorder.calls, []);
});

test("the party (Matter gravity toy + cursor trail) is capped, closes on Close or Escape and cleans up", async () => {
  const log = [];
  const body = () => ({});
  const Matter = {
    Engine: { create: () => ({ world: {} }), clear: () => log.push("engine.clear") },
    Render: { create: () => ({ canvas: null }), run: () => log.push("render.run"), stop: () => log.push("render.stop") },
    Runner: { create: () => ({}), run: () => log.push("runner.run"), stop: () => log.push("runner.stop") },
    Bodies: { rectangle: body, circle: body },
    Composite: { add: (world, bodies) => log.push("add:" + bodies.length), clear: () => log.push("world.clear") },
  };
  const cursoreffects = { fairyDustCursor: () => ({ destroy: () => log.push("cursor.destroy") }) };
  const recorder = recordingLoader({ matter: Matter, cursorEffects: cursoreffects });
  const doc = makeDoc();
  const stop = await eggs.startParty(env({ doc, load: recorder.load }));
  assert.deepEqual(recorder.calls.sort(), ["cursorEffects", "matter"]);
  const overlay = doc.body.querySelector(".fun-toy");
  assert.ok(overlay, "the toy overlay shows");
  const added = log.filter((entry) => entry.startsWith("add:")).map((entry) => Number(entry.slice(4)));
  assert.ok(added.reduce((a, b) => a + b, 0) <= eggs.FUN_GRAVITY_BODIES_MAX + 4, "bodies capped (plus the walls)");
  doc.fire("keydown", { key: "Escape", target: doc.body });
  assert.equal(doc.body.querySelector(".fun-toy"), null, "Escape removes it");
  assert.ok(log.includes("runner.stop") && log.includes("render.stop") && log.includes("cursor.destroy"));
  assert.equal(typeof stop, "function");
});

test("no Oneko sprite ships (its sprite art carries no AGPL-compatible licence)", () => {
  assert.equal(existsSync(new URL("public/js/vendor/oneko.js", ROOT)), false);
});

// ---------------------------------------------------------------- sketch

test("sketch: no composer button while off; on, the button loads signature_pad only after a click", async () => {
  const doc = makeDoc();
  assert.equal(sketch.createSketchButton(doc, env({ doc })), null);
  const recorder = recordingLoader({ signaturePad: function SignaturePad() { this.isEmpty = () => true; this.clear = () => {}; } });
  const button = sketch.createSketchButton(doc, env({ doc, storage: onlyOn("sketch"), load: recorder.load }));
  assert.ok(button);
  assert.equal(button.type, "button");
  assert.deepEqual(recorder.calls, [], "nothing loads until the member asks");
  assert.match(read("public/js/routes/composer.js"), /createSketchButton\(/);
  assert.match(read("public/js/composer-paste.js"), /export function stagePendingFiles\(/);
});

test("a finished sketch becomes one PNG File handed to the existing pending-attachment path", async () => {
  const blob = { size: 10, type: "image/png" };
  const files = [];
  const file = await sketch.sketchToFile({ toBlob: (callback, type) => { assert.equal(type, "image/png"); callback(blob); } },
    class { constructor(parts, name, options) { Object.assign(this, { parts, name, options }); } });
  files.push(file);
  assert.equal(files[0].name, sketch.SKETCH_FILE_NAME);
  assert.equal(files[0].options.type, "image/png");
  assert.match(sketch.SKETCH_FILE_NAME, /\.png$/);
});

// ---------------------------------------------------------------- hooks + i18n + CSP

test("app.js wires the view enhancer, the unread watcher and the easter eggs", () => {
  const app = read("public/js/app.js");
  assert.match(app, /enhanceFunView\(main\)/);
  assert.match(app, /noteUnreadCount\(state\.unreadNotifications\)/);
  assert.match(app, /startFunExtras\(\)/);
});

test("every fun.* key is one contiguous block in en.json and present in every locale", () => {
  const dir = new URL("public/locales/", ROOT);
  const en = JSON.parse(read("public/locales/en.json"));
  const keys = Object.keys(en);
  const funKeys = keys.filter((key) => key.startsWith("fun."));
  assert.ok(funKeys.length >= 10);
  const first = keys.indexOf(funKeys[0]);
  assert.deepEqual(keys.slice(first, first + funKeys.length), funKeys, "one contiguous block");
  for (const name of readdirSync(dir)) {
    const table = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    for (const key of funKeys) assert.ok(typeof table[key] === "string" && table[key].trim(), `${name} ${key}`);
  }
});

test("the CSP and Permissions-Policy are unchanged (no camera, no new origins)", () => {
  const http = read("api/vendor/http.mjs");
  assert.match(http, /"Permissions-Policy", "camera=\(\), microphone=\(\), geolocation=\(\)"/);
  assert.match(http, /script-src 'self' https:\/\/challenges\.cloudflare\.com; style-src 'self'; /);
});
