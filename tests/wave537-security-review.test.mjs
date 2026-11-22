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

// Wave 5.37 — security review of 20fd747..0007c10 (v5.33–v5.36)
// (docs/security-reviews/2026-11-22-v5.33-v5.36.md). RED-first fix:
//   L1: the client claimed a pending invite BEFORE it stored the session's
//       CSRF token, so on the page load that follows the Accounts sign-up the
//       POST /api/me/invite went out without X-CSRF-Token, got a 403, and the
//       ref was already forgotten — the invite was never credited.
// Plus pins for checks that passed (feeds ignore cookies; ACAO * only on the
// public, cookie-free documents).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedPost, seedUser } from "./helpers/seed.mjs";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

// ---- L1: invite claim before the CSRF token --------------------------------

function prepareRouteContextBody() {
  const app = source("public/js/app.js");
  const start = app.indexOf("async function prepareRouteContext(");
  assert.ok(start >= 0, "prepareRouteContext exists");
  const end = app.indexOf("\n}\n", start);
  return app.slice(start, end);
}

test("L1: the session's CSRF token is stored before the pending invite is claimed", () => {
  const body = prepareRouteContextBody();
  const tokenAt = body.indexOf("setCsrfToken(session.csrfToken)");
  const claimAt = body.indexOf("claimPendingInvite(api)");
  assert.ok(tokenAt >= 0, "prepareRouteContext stores the CSRF token");
  assert.ok(claimAt >= 0, "prepareRouteContext claims the pending invite");
  assert.ok(tokenAt < claimAt, "the claim POST must carry X-CSRF-Token, so the token is set first");
});

test("L1: a claim without X-CSRF-Token is refused (why the order matters)", async () => {
  const env = makeEnv();
  await seedUser(env.__sqlite, { username: "inviter537" });
  const newbie = await seedUser(env.__sqlite, { username: "newbie537" });
  const session = forgeSession(env.__sqlite, newbie);
  const res = await call(env, "/api/me/invite", {
    method: "POST", body: { ref: "inviter537" }, session: { ...session, csrf: "" },
  });
  assert.equal(res.status, 403);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM invites").get().n, 0);
});

// ---- pins: feeds are one cookie-free public document ------------------------

test("pin: a feed is byte-identical for a guest and a blocking member, sets no cookie", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const author = await seedUser(db, { username: "feedauthor537" });
  const blocker = await seedUser(db, { username: "feedblocker537" });
  seedPost(db, { authorId: author, body: "FEEDPIN537 topic" });
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(blocker, author, 1);
  const guest = await call(env, "/feed.xml");
  const member = await call(env, "/feed.xml", { session: forgeSession(db, blocker) });
  assert.equal(guest.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(guest.headers.get("Set-Cookie"), null);
  assert.equal(member.headers.get("Set-Cookie"), null);
  assert.equal(member.headers.get("ETag"), guest.headers.get("ETag"));
  const xml = await guest.text();
  assert.ok(xml.includes("FEEDPIN537"));
  assert.equal(await member.text(), xml, "the feed never personalises, so ACAO * leaks nothing");
});

test("pin: the signed-in JSON API carries no wildcard CORS header", async () => {
  const env = makeEnv();
  const user = await seedUser(env.__sqlite, { username: "corspin537" });
  const res = await call(env, "/api/session", { session: forgeSession(env.__sqlite, user) });
  assert.equal(res.status, 200);
  assert.notEqual(res.headers.get("Access-Control-Allow-Origin"), "*");
});
