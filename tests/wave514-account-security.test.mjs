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

// Wave 5.14: F1 backup codes left, F2 sign out my other devices (both via
// api/account-security.mjs + public/js/account-security.js), F3 actual size in
// the image viewer (public/js/lightbox.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, makeRequest, seedUser, sha256 } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import {
  backupCodesLeftText,
  fillBackupCodesLeft,
  createSessionsPanel,
  fillSessionsPanel,
} from "../public/js/account-security.js";
import { openLightbox } from "../public/js/lightbox.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();
const now = () => Math.floor(Date.now() / 1000);

let env, db, alice, bob, sA, sB;

const seedCodes = (userId, count) => {
  for (let index = 0; index < count; index++) {
    db.prepare("INSERT INTO totp_backup_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)")
      .run(userId, sha256(`code-${userId}-${index}`), now());
  }
};
const enableTotp = (userId) =>
  db.prepare("UPDATE users SET totp_enabled = 1, totp_secret = 'JBSWY3DPEHPK3PXP' WHERE id = ?").run(userId);
const sessionCount = (userId) =>
  db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId).n;
const security = async (session) => call(env, "/api/me/security", session ? { session } : undefined);
const signOutOthers = (session, opts = {}) =>
  call(env, "/api/me/sessions/sign-out-others", { method: "POST", body: {}, session, ...opts });

beforeEach(async () => {
  env = makeEnv();
  db = env.__sqlite;
  alice = await seedUser(db, { username: "Alice" });
  bob = await seedUser(db, { username: "Bob" });
  sA = forgeSession(db, alice);
  sB = forgeSession(db, bob);
});

// --- F1: backup codes left ------------------------------------------------------

test("F1: GET /api/me/security refuses a guest with 401", async () => {
  assert.equal((await security()).status, 401);
});

test("F1: counts only the caller's own unused backup codes while 2FA is on", async () => {
  enableTotp(alice);
  seedCodes(alice, 4);
  seedCodes(bob, 9);
  const res = await security(sA);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totpEnabled, true);
  assert.equal(body.backupCodesLeft, 4);
});

test("F1: 2FA off reports zero codes left and totpEnabled false", async () => {
  seedCodes(alice, 3);
  const body = await (await security(sA)).json();
  assert.equal(body.totpEnabled, false);
  assert.equal(body.backupCodesLeft, 0);
});

test("F1/F2: the payload carries counts only — no secret, hash, code or token", async () => {
  enableTotp(alice);
  seedCodes(alice, 2);
  const res = await security(sA);
  const text = await res.text();
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["backupCodesLeft", "otherSessions", "totpEnabled"]);
  assert.doesNotMatch(text, /JBSWY3DPEHPK3PXP|secret|hash|token|code_/i);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
});

test("F1 DOM: the note reads the count, warns at 3 or fewer, and says none at 0", () => {
  assert.equal(backupCodesLeftText(7), t("account.backupLeft", { count: 7 }));
  const panel = new FakeNode("section");
  fillBackupCodesLeft(panel, 7, fakeDocument);
  const note = findByClass(panel, "backup-codes-left");
  assert.ok(note);
  assert.equal(note.textContent, t("account.backupLeft", { count: 7 }));
  assert.equal(note.dataset.level, "ok");
  fillBackupCodesLeft(panel, 2, fakeDocument);
  assert.equal(panel.querySelectorAll(".backup-codes-left").length, 1, "refill replaces, never stacks");
  const low = findByClass(panel, "backup-codes-left");
  assert.equal(low.dataset.level, "low");
  assert.match(low.textContent, new RegExp(t("account.backupLow").slice(0, 12)));
  fillBackupCodesLeft(panel, 0, fakeDocument);
  const none = findByClass(panel, "backup-codes-left");
  assert.equal(none.dataset.level, "none");
  assert.equal(none.textContent, t("account.backupNone"));
});

test("F1 DOM: the note is a div, so opening the generate form (which keeps h2/p) clears the stale count", () => {
  const panel = new FakeNode("section");
  fillBackupCodesLeft(panel, 5, fakeDocument);
  assert.equal(findByClass(panel, "backup-codes-left").tagName, "DIV");
});

// --- F2: sign out my other devices ----------------------------------------------

test("F2: the security read counts the caller's other unexpired sessions, not this one", async () => {
  forgeSession(db, alice);
  forgeSession(db, alice);
  db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sha256("expired"), alice, "c", now() - 100, now() - 10);
  forgeSession(db, bob);
  const body = await (await security(sA)).json();
  assert.equal(body.otherSessions, 2);
});

test("F2: sign-out-others refuses a guest and a missing CSRF token; nothing is deleted", async () => {
  forgeSession(db, alice);
  assert.equal((await signOutOthers(undefined)).status, 403);
  const noCsrf = makeRequest("/api/me/sessions/sign-out-others", { method: "POST", body: {}, session: sA });
  noCsrf.headers.delete("X-CSRF-Token");
  const worker = await import("../worker.mjs");
  const res = await worker.default.fetch(noCsrf, env, { waitUntil() {} });
  assert.equal(res.status, 403);
  assert.equal(sessionCount(alice), 2);
});

test("F2: deletes only the caller's OTHER sessions — this one, another member's and guest rows survive", async () => {
  forgeSession(db, alice);
  forgeSession(db, alice);
  db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)")
    .run(sha256("guest"), "g", now(), now() + 3600);
  const res = await signOutOthers(sA);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { signedOut: 2 });
  assert.equal(sessionCount(alice), 1);
  assert.equal(sessionCount(bob), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id IS NULL").get().n, 1);
  assert.equal((await security(sA)).status, 200, "this device stays signed in");
  assert.equal((await (await security(sA)).json()).otherSessions, 0);
});

test("F2 DOM: the panel paints the count and hides the button when nothing else is signed in", () => {
  const panel = createSessionsPanel(fakeDocument);
  const button = panel.querySelector("button");
  assert.equal(button.dataset.action, "sessions-sign-out-others");
  assert.equal(button.textContent, t("account.sessionsSignOut"));
  fillSessionsPanel(panel, 3);
  assert.equal(findByClass(panel, "sessions-count").textContent, t("account.sessionsCount", { count: 3 }));
  assert.equal(button.hidden, false);
  fillSessionsPanel(panel, 0);
  assert.equal(findByClass(panel, "sessions-count").textContent, t("account.sessionsNone"));
  assert.equal(button.hidden, true);
});

test("F2 wiring: settings mount the panel and app.js registers the action", () => {
  assert.match(read("public/js/routes/feed.js"), /renderAccountSecurity\(account\)/);
  assert.match(read("public/js/app.js"), /account-security\.js/);
  assert.match(read("worker.mjs"), /handleAccountSecurityRoutes/);
});

// --- F3: actual size in the image viewer ----------------------------------------

const buildStrip = (count) => {
  const strip = new FakeNode("div");
  strip.className = "post-attachments";
  const thumbs = Array.from({ length: count }, (_, index) => {
    const thumb = new FakeNode("button");
    thumb.className = "attachment-expand";
    const img = new FakeNode("img");
    img.src = `/api/attachments/a${index}?v=1`;
    thumb.append(img);
    strip.append(thumb);
    return thumb;
  });
  new FakeNode("article").append(strip);
  return thumbs;
};
const buildDialog = () => {
  const dialog = new FakeNode("dialog");
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatch("close"); };
  dialog.append(new FakeNode("img"));
  return dialog;
};

test("F3: Actual size toggles data-size and aria-pressed", () => {
  const thumbs = buildStrip(2);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  const toggle = dialog.querySelector(".lightbox-size");
  assert.ok(toggle);
  assert.equal(toggle.textContent, t("lightbox.actualSize"));
  assert.equal(dialog.dataset.size, "fit");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  toggle.dispatch("click");
  assert.equal(dialog.dataset.size, "actual");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  toggle.dispatch("click");
  assert.equal(dialog.dataset.size, "fit");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
});

test("F3: stepping to another image and closing both reset to fit", () => {
  const thumbs = buildStrip(2);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  const toggle = dialog.querySelector(".lightbox-size");
  toggle.dispatch("click");
  dialog.querySelector(".lightbox-next").dispatch("click");
  assert.equal(dialog.dataset.size, "fit");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  toggle.dispatch("click");
  dialog.close();
  assert.equal(dialog.dataset.size, "fit");
});

test("F3: the toggle is page-view only (no storage, no network) and styled", () => {
  assert.doesNotMatch(read("public/js/lightbox.js"), /localStorage|sessionStorage|api\(/);
  assert.match(read("public/styles.css"), /\.attachment-lightbox\[data-size="actual"\]/);
});

test("F3: at actual size a click on the image zooms back to fit instead of closing", () => {
  const thumbs = buildStrip(1);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  const image = dialog.querySelector("img");
  dialog.querySelector(".lightbox-size").dispatch("click");
  dialog.dispatch("click", { target: image });
  assert.equal(dialog.dataset.size, "fit");
  assert.equal(dialog.open, true);
  dialog.dispatch("click", { target: image });
  assert.equal(dialog.open, false);
});
