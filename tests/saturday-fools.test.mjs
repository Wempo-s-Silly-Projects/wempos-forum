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

// Saturday Fools FRAMEWORK (v5.86): env switch + owner-only off switch, the
// shell meta, the fun-gate seam, the dated-gag pick on the visitor's local
// Saturday, midnight auto-off, reduced motion, the close-the-banner-only
// note, form safety, and the index contract. Every test here runs with
// injected gags (most with ZERO), so it stays green when a week's gag module
// is stripped; the gag's own pins live in tests/saturday-fools-<date>.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedUser } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { DEFAULT_SATURDAY_FOOLS, SATURDAY_FOOLS_OFF_SETTING } from "../constants.mjs";
import { saturdayFoolsMeta, saturdayFoolsMode } from "../api/saturday-fools.mjs";
import { checkSaturdayFools, saturdayFoolsDue } from "../public/js/fun-gate.js";
import {
  FOOLS_BANNER_CLOSED_KEY, createSaturdayFools, gagForDate, gagRunner, isLocalSaturday, isValidGag,
  localDateKey, msUntilLocalMidnight,
} from "../public/js/fun/saturday-fools.js";
import { GAGS } from "../public/js/fun/saturday-fools/index.js";
import { preserveAccessibleName, restoreAccessibleNames, cssString } from "../public/js/fun/saturday-fools/helpers.js";
import { FOOLS_SAVE_FORM, isOwner } from "../public/js/desk/saturday-fools.js";
import { FORM_OWNERS } from "../public/js/route-modules.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

// Local-time clocks (the constructor reads the runner's own zone, like a visitor).
const FRI_2359 = new Date(2026, 10, 27, 23, 59);
const SAT_0000 = new Date(2026, 10, 28, 0, 0);
const SAT_2300 = new Date(2026, 10, 28, 23, 0);
const SUN_0000 = new Date(2026, 10, 29, 0, 0);
const NEXT_SAT = new Date(2026, 11, 5, 12, 0);

function fakeGag(overrides = {}) {
  const calls = { apply: 0, undo: 0, enhance: 0 };
  const gag = {
    id: "2026-11-28-test", date: "2026-11-28", name: "fools.banner", motion: false,
    apply: () => { calls.apply += 1; return () => { calls.undo += 1; }; },
    enhance: () => { calls.enhance += 1; },
    ...overrides,
  };
  return { gag, calls };
}

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}

function fakeDoc({ meta = "on" } = {}) {
  const html = new FakeNode("html");
  const props = {};
  html.style = { props, setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } };
  const body = new FakeNode("body");
  html.append(body);
  const metaNode = meta === null ? null : { getAttribute: (name) => (name === "content" ? meta : null) };
  return makeFakeDocument({
    documentElement: html,
    body,
    querySelector: (selector) => (selector.includes("saturday-fools") ? metaNode : html.querySelector(selector)),
    querySelectorAll: (selector) => html.querySelectorAll(selector),
    addEventListener() {},
  });
}

function fakeWin() {
  const timers = [];
  return { timers, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {} };
}

function controller({ gags = [], meta = "on", clock = SAT_0000, reduced = false, storage = memoryStorage() } = {}) {
  const doc = fakeDoc({ meta });
  const win = fakeWin();
  let now = clock;
  const fools = createSaturdayFools({ doc, win, storage, now: () => now, reducedMotion: () => reduced, gags });
  return { fools, doc, win, storage, setNow: (date) => { now = date; } };
}

const banners = (doc) => doc.body.querySelectorAll(".fools-banner");

// ---- per-deployment switch + owner switch (server) ------------------------

test("SATURDAY_FOOLS defaults off; only exactly \"on\" turns it on; production sets it on", () => {
  assert.equal(DEFAULT_SATURDAY_FOOLS, "off");
  assert.equal(saturdayFoolsMode({}), "off");
  assert.equal(saturdayFoolsMode({ SATURDAY_FOOLS: "ON" }), "off");
  assert.equal(saturdayFoolsMode({ SATURDAY_FOOLS: "true" }), "off");
  assert.equal(saturdayFoolsMode({ SATURDAY_FOOLS: "on" }), "on");
  assert.match(read("wrangler.toml"), /^SATURDAY_FOOLS = "on"$/m);
  assert.doesNotMatch(read("wrangler.example.toml"), /^SATURDAY_FOOLS = "on"$/m, "self-hosters start with it off");
});

const shell = async (env) => (await worker.fetch(new Request("https://wempos-forum.com/"), env, {})).text();
const forceOff = (env, value) => env.__sqlite.prepare(
  "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, 0)",
).run(SATURDAY_FOOLS_OFF_SETTING, value);

test("the shell meta appears only with env on AND no owner force-off", async () => {
  const off = makeEnv({ SATURDAY_FOOLS: "off" });
  assert.equal(await saturdayFoolsMeta(off), "");
  assert.doesNotMatch(await shell(off), /name="saturday-fools"/);
  const on = makeEnv({ SATURDAY_FOOLS: "on" });
  assert.equal(await saturdayFoolsMeta(on), "on");
  assert.match(await shell(on), /<meta name="saturday-fools" content="on">/);
  forceOff(on, "1");
  assert.equal(await saturdayFoolsMeta(on), "");
  assert.doesNotMatch(await shell(on), /name="saturday-fools"/);
  const unset = makeEnv();
  assert.doesNotMatch(await shell(unset), /name="saturday-fools"/);
});

test("a failed switch read counts as forced off (never turns a gag on)", async () => {
  const broken = { SATURDAY_FOOLS: "on", FORUM_DB: { prepare: () => { throw new Error("down"); } } };
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await saturdayFoolsMeta(broken), "");
  } finally {
    console.error = quiet;
  }
});

async function signedIn(env, role) {
  const id = await seedUser(env.__sqlite, { username: "F" + role + Math.floor(Math.random() * 1e6), role });
  return forgeSession(env.__sqlite, id);
}

test("the owner switch is owner-only: owner saves, admins and members get 403", async () => {
  const env = makeEnv({ SATURDAY_FOOLS: "on" });
  const owner = await signedIn(env, "admin"); // stored 'admin' = public owner
  const admin = await signedIn(env, "moderator"); // stored 'moderator' = public admin (staff)
  const member = await signedIn(env, "member");
  for (const session of [admin, member]) {
    assert.equal((await call(env, "/api/admin/saturday-fools", { session })).status, 403);
    assert.equal((await call(env, "/api/admin/saturday-fools", { method: "POST", session, body: { forcedOff: true } })).status, 403);
  }
  assert.equal(await saturdayFoolsMeta(env), "on", "a refused save changed nothing");
  const saved = await call(env, "/api/admin/saturday-fools", { method: "POST", session: owner, body: { forcedOff: true } });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { saved: true, mode: "on", forcedOff: true, active: false });
  assert.equal(await saturdayFoolsMeta(env), "");
  const back = await call(env, "/api/admin/saturday-fools", { method: "POST", session: owner, body: { forcedOff: false } });
  assert.equal((await back.json()).active, true);
  assert.equal(await saturdayFoolsMeta(env), "on");
  assert.equal((await call(env, "/api/admin/saturday-fools", { method: "POST", session: owner, body: { forcedOff: "yes" } })).status, 400);
  const state = await (await call(env, "/api/admin/saturday-fools", { session: owner })).json();
  assert.deepEqual(state, { mode: "on", forcedOff: false, active: true });
});

test("the desk switch renders for the owner only and its form is owned by the admin module", () => {
  assert.equal(isOwner({ role: "owner" }), true);
  assert.equal(isOwner({ role: "admin" }), false);
  assert.equal(isOwner(null), false);
  assert.equal(FORM_OWNERS[FOOLS_SAVE_FORM], "admin");
  assert.match(read("public/js/routes/admin.js"), /isOwner\(user\) \? createFoolsSwitch\(document\) : null/);
});

// ---- local Saturday, dated pick ----------------------------------------------

test("active only on the visitor's local Saturday (injected clock)", () => {
  assert.equal(isLocalSaturday(FRI_2359), false);
  assert.equal(isLocalSaturday(SAT_0000), true);
  assert.equal(isLocalSaturday(SAT_2300), true);
  assert.equal(isLocalSaturday(SUN_0000), false);
  assert.equal(localDateKey(SAT_0000), "2026-11-28");
  assert.equal(localDateKey(new Date(2027, 0, 2)), "2027-01-02");
});

test("gagForDate picks the gag dated for today's local Saturday, else nothing", () => {
  const { gag } = fakeGag();
  assert.equal(gagForDate([gag], SAT_0000), gag);
  assert.equal(gagForDate([gag], SAT_2300), gag);
  assert.equal(gagForDate([gag], FRI_2359), null);
  assert.equal(gagForDate([gag], SUN_0000), null);
  assert.equal(gagForDate([gag], NEXT_SAT), null, "no permanent fallback pool: an undated Saturday is quiet");
  assert.equal(gagForDate([], SAT_0000), null);
  assert.equal(gagForDate(undefined, SAT_0000), null);
  const friday = fakeGag({ date: "2026-11-27" }).gag;
  assert.equal(gagForDate([friday], FRI_2359), null, "a gag dated on a non-Saturday never runs");
  assert.equal(isValidGag({ ...gag, apply: null }), false);
  assert.equal(isValidGag({ ...gag, date: "28/11/2026" }), false);
  assert.equal(gagForDate([{ ...gag, apply: "x" }], SAT_0000), null, "malformed gags are ignored");
});

test("ZERO gag modules: the framework does nothing on a Saturday with the meta on", () => {
  const { fools, doc, win } = controller({ gags: [] });
  assert.equal(fools.refresh(), null);
  fools.enhance(doc.documentElement);
  assert.equal(banners(doc).length, 0);
  assert.equal(doc.documentElement.className, "");
  assert.equal(win.timers.length, 0);
});

test("a dated gag runs on its Saturday with a banner, and not when the meta is off", () => {
  const on = fakeGag();
  const live = controller({ gags: [on.gag] });
  assert.equal(live.fools.refresh(), on.gag);
  assert.equal(on.calls.apply, 1);
  assert.equal(banners(live.doc).length, 1);
  live.fools.refresh();
  assert.equal(on.calls.apply, 1, "refresh on the same day does not re-apply");
  live.fools.enhance(live.doc.documentElement);
  assert.equal(on.calls.enhance, 1);
  for (const meta of ["off", "", null]) {
    const off = fakeGag();
    const quiet = controller({ gags: [off.gag], meta });
    assert.equal(quiet.fools.refresh(), null, "meta " + meta);
    assert.equal(off.calls.apply, 0);
    assert.equal(banners(quiet.doc).length, 0);
  }
});

test("auto-off at local midnight: the timer fires, undo runs, the banner goes", () => {
  const { gag, calls } = fakeGag();
  const live = controller({ gags: [gag], clock: SAT_2300 });
  live.fools.refresh();
  assert.equal(live.win.timers.length, 1);
  assert.equal(live.win.timers[0].ms, 60 * 60 * 1000);
  assert.equal(msUntilLocalMidnight(SAT_2300), 60 * 60 * 1000);
  live.setNow(SUN_0000);
  live.win.timers[0].fn();
  assert.equal(calls.undo, 1);
  assert.equal(live.fools.active(), null);
  assert.equal(banners(live.doc).length, 0);
});

test("reduced motion runs the still variant, and skips a moving gag that has none", () => {
  const still = { count: 0 };
  const moving = fakeGag({ motion: true, reducedMotionApply: () => { still.count += 1; } });
  controller({ gags: [moving.gag], reduced: true }).fools.refresh();
  assert.equal(moving.calls.apply, 0);
  assert.equal(still.count, 1);
  const bare = fakeGag({ motion: true });
  const skipped = controller({ gags: [bare.gag], reduced: true });
  skipped.fools.refresh();
  skipped.fools.enhance(skipped.doc.documentElement);
  assert.equal(bare.calls.apply, 0);
  assert.equal(bare.calls.enhance, 0);
  const calm = fakeGag({ motion: false });
  controller({ gags: [calm.gag], reduced: true }).fools.refresh();
  assert.equal(calm.calls.apply, 1, "a still gag runs as-is under reduced motion");
  assert.equal(gagRunner(moving.gag, false), moving.gag.apply);
});

test("closing the banner hides the banner only (for the day); the gag keeps running", () => {
  const storage = memoryStorage();
  const { gag, calls } = fakeGag();
  const live = controller({ gags: [gag], storage });
  live.fools.refresh();
  const [banner] = banners(live.doc);
  const close = banner.querySelector("button");
  assert.equal(close.type, "button", "never a submit button");
  close.dispatch("click");
  assert.equal(banners(live.doc).length, 0);
  assert.equal(calls.undo, 0, "the gag is NOT turned off");
  assert.equal(live.fools.active(), gag);
  assert.equal(storage.map.get(FOOLS_BANNER_CLOSED_KEY), "2026-11-28");
  const again = controller({ gags: [gag], storage });
  again.fools.refresh();
  assert.equal(banners(again.doc).length, 0, "stays closed the same day");
  assert.equal(calls.apply, 2, "but the gag still runs in the next tab");
  const nextWeek = controller({ gags: [{ ...gag, date: "2026-12-05" }], storage, clock: NEXT_SAT });
  nextWeek.fools.refresh();
  assert.equal(banners(nextWeek.doc).length, 1, "a new Saturday shows the note again");
});

test("no member opt-out exists: no skip toggle, no turn-off actions", () => {
  const engine = read("public/js/fun/saturday-fools.js");
  assert.doesNotMatch(engine, /skipSaturday|turnOffToday|neverShow/);
  const en = JSON.parse(read("public/locales/en.json"));
  assert.deepEqual(Object.keys(en).filter((key) => /^fools\.(skip|never|turnOff)/.test(key)), []);
  assert.equal(banners(controller({ gags: [fakeGag().gag] }).doc).length, 0, "nothing paints before refresh");
});

test("a throwing gag is isolated: no crash, the page keeps working", () => {
  const boom = fakeGag({ apply: () => { throw new Error("boom"); }, enhance: () => { throw new Error("boom"); } });
  const live = controller({ gags: [boom.gag] });
  assert.doesNotThrow(() => live.fools.refresh());
  assert.doesNotThrow(() => live.fools.enhance(live.doc.documentElement));
  assert.doesNotThrow(() => live.fools.stop());
});

test("the framework never adds listeners to forms or submit buttons", () => {
  const { gag } = fakeGag();
  const live = controller({ gags: [gag] });
  const form = new FakeNode("form");
  form.setAttribute("data-form", "reply");
  const submit = new FakeNode("button");
  submit.setAttribute("type", "submit");
  form.append(submit);
  live.doc.body.append(form);
  live.fools.refresh();
  live.fools.enhance(live.doc.documentElement);
  assert.deepEqual(form.listeners, {});
  assert.deepEqual(submit.listeners, {});
  assert.doesNotMatch(read("public/js/fun/saturday-fools.js"), /preventDefault|"submit"|requestSubmit/);
});

// ---- accessibility helpers ---------------------------------------------------

test("preserveAccessibleName pins the real label and restore removes only what it set", () => {
  const button = new FakeNode("button");
  button.textContent = " Reply ";
  assert.equal(preserveAccessibleName(button), true);
  assert.equal(button.getAttribute("aria-label"), "Reply");
  const labelled = new FakeNode("button");
  labelled.textContent = "Post";
  labelled.setAttribute("aria-label", "Publish post");
  assert.equal(preserveAccessibleName(labelled), false);
  const root = new FakeNode("div");
  root.append(button, labelled);
  restoreAccessibleNames(root);
  assert.equal(button.hasAttribute("aria-label"), false);
  assert.equal(labelled.getAttribute("aria-label"), "Publish post", "an author's own label is never removed");
  assert.equal(cssString('Say "hi" \\ now\n'), '"Say \\"hi\\" \\\\ now "');
});

// ---- the fun-gate seam ---------------------------------------------------------

const metaDoc = (content) => ({ querySelector: (s) => (s.includes("saturday-fools") && content !== null ? { getAttribute: () => content } : null) });

test("fun-gate loads the module only with the meta on AND a local Saturday", async () => {
  assert.equal(saturdayFoolsDue(metaDoc("on"), SAT_0000), true);
  assert.equal(saturdayFoolsDue(metaDoc("on"), FRI_2359), false);
  assert.equal(saturdayFoolsDue(metaDoc("on"), SUN_0000), false);
  assert.equal(saturdayFoolsDue(metaDoc("off"), SAT_0000), false);
  assert.equal(saturdayFoolsDue(metaDoc(null), SAT_0000), false);
  let imports = 0;
  const importer = () => { imports += 1; return Promise.resolve({ startSaturdayFools() {}, enhanceSaturdayFools() {} }); };
  assert.equal(checkSaturdayFools(metaDoc("off"), SAT_0000, importer), null);
  assert.equal(checkSaturdayFools(metaDoc("on"), FRI_2359, importer), null);
  assert.equal(imports, 0, "off / not Saturday: nothing is fetched");
  await checkSaturdayFools(metaDoc("on"), SAT_0000, importer);
  assert.equal(imports, 1);
  assert.equal(checkSaturdayFools(metaDoc("on"), SAT_0000, importer), null, "loaded once");
});

// ---- the index contract (tolerates zero or many gags) -------------------------

test("every indexed gag is valid, dated on a Saturday, and strippable by its tagged lines", () => {
  assert.ok(Array.isArray(GAGS));
  const index = read("public/js/fun/saturday-fools/index.js");
  for (const gag of GAGS) {
    assert.ok(isValidGag(gag), gag.id);
    const [y, m, d] = gag.date.split("-").map(Number);
    assert.equal(new Date(y, m - 1, d).getDay(), 6, gag.id + " is dated on a Saturday");
    assert.ok(gag.id.startsWith(gag.date + "-"), gag.id + " starts with its date");
    assert.ok(existsSync(new URL(`public/js/fun/saturday-fools/${gag.id}.js`, ROOT)), gag.id + " module file");
    assert.equal(index.split("\n").filter((line) => line.includes(`// saturday-fools:${gag.date}`)).length, 2,
      gag.id + ": one import line + one list line, both tagged");
    assert.match(gag.name, new RegExp(`^fools\\.${gag.date.replaceAll("-", "")}\\.`), "keys under fools.<yyyymmdd>.*");
    assert.ok(existsSync(new URL(`tests/saturday-fools-${gag.date}.test.mjs`, ROOT)), gag.id + " has its own test");
    if (gag.motion) assert.equal(typeof gag.reducedMotionApply, "function", gag.id + " moves, so it needs a still variant");
  }
  assert.equal(new Set(GAGS.map((gag) => gag.date)).size, GAGS.length, "one gag per Saturday");
});

test("the strip guide exists and names every piece to delete", () => {
  const doc = read("docs/saturday-fools.md");
  for (const needle of ["public/js/fun/saturday-fools/", "index.js", "saturday-fools:", "styles.css",
    "fools.", "tests/saturday-fools-", "April Fools version", "IDEAS"]) {
    assert.ok(doc.includes(needle), "docs/saturday-fools.md mentions " + needle);
  }
});
