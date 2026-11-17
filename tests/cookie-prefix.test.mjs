// Copyright 2026 YourLocalGoober
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

// The __Host- wave's regression lane: the mint shape carries the prefixed,
// always-Secure name; the legacy bare name still reads and self-migrates —
// readSession marks the request (WeakMap, zero DB writes) with the pending
// pair, and the worker's ONE funnel (withPendingCookieMigration) appends the
// SAME token re-issued under the prefixed name plus the legacy clear. This
// file comes out on the named cleanup row.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pendingCookieMigration, readSession, createSession } from "../api/core/auth.mjs";

const SESSION_TOKEN = "A".repeat(44);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SOURCE = readFileSync(path.resolve(HERE, "../worker.mjs"), "utf-8");

// Recording fake db (mirrors tests/backup-codes.test.mjs): statements are
// recorded at bind time, and run() answers the changes count.
function fakeDb(sqlAnswers = {}) {
  const statements = [];
  const answer = (sql) => {
    for (const [needle, value] of Object.entries(sqlAnswers)) {
      if (sql.includes(needle)) return value;
    }
    return null;
  };
  const mk = (sql, params) => {
    statements.push({ sql, params });
    return {
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 1, last_row_id: statements.length } }),
    };
  };
  return {
    statements,
    prepare: (sql) => ({
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      bind: (...params) => mk(sql, params),
    }),
    batch: async (stmts) => stmts.map((_, index) => ({ meta: { changes: 1, last_row_id: index + 1 } })),
  };
}

const SESSION_ROW = {
  token_hash: "h", user_id: 2, csrf_token: "c".repeat(24), expires_at: 9999999999,
  username: "tester", role: "member", bio: "", avatar_status: null,
  avatar_mime: null, avatar_updated_at: null, avatar_version: null, totp_enabled: 0,
};

function sessionRequest(cookieName, token) {
  return new Request("https://forum.test/api/session", {
    method: "GET",
    headers: { "Cookie": cookieName + "=" + token },
  });
}

test("the mint always rides the prefixed name with unconditional Secure", async () => {
  const session = await createSession(sessionRequest("__Host-wempo_session", SESSION_TOKEN),
    { FORUM_DB: fakeDb() }, 2);
  assert.ok(session.setCookie.startsWith("__Host-wempo_session="),
    "login mints the prefixed cookie name");
  assert.ok(!session.setCookie.startsWith("wempo_session="), "no bare legacy mint");
  assert.ok(session.setCookie.includes("; Path=/; HttpOnly; SameSite=Lax; Max-Age="),
    "the prefix contract's cookie attributes stay intact");
  assert.ok(session.setCookie.endsWith("; Secure"), "Secure is unconditional");
});

test("a legacy-only hit authenticates and marks the request with the migration pair", async () => {
  const request = sessionRequest("wempo_session", SESSION_TOKEN);
  const session = await readSession(request,
    { FORUM_DB: fakeDb({ "FROM sessions s LEFT JOIN users": SESSION_ROW }) });
  assert.ok(session, "the legacy cookie still resolves the live row");
  const migration = pendingCookieMigration(request);
  assert.ok(Array.isArray(migration) && migration.length === 2,
    "the WeakMap mark carries the pending pair");
  assert.match(
    migration[0],
    /^__Host-wempo_session=A{44}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/,
    "the SAME token re-issues under the prefixed name (Secure unconditional)",
  );
  assert.equal(migration[1],
    "wempo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    "the bare legacy name clears alongside");
});

test("a prefixed hit reads with no pending pair", async () => {
  const request = sessionRequest("__Host-wempo_session", SESSION_TOKEN);
  const session = await readSession(request,
    { FORUM_DB: fakeDb({ "FROM sessions s LEFT JOIN users": SESSION_ROW }) });
  assert.ok(session, "the prefixed cookie resolves the live row");
  assert.equal(pendingCookieMigration(request), null,
    "no mark rides a cookie already at the prefixed name");
});

test("an unparseable legacy token stays null and never marks", async () => {
  const request = sessionRequest("wempo_session", "short");
  const session = await readSession(request, { FORUM_DB: fakeDb() });
  assert.equal(session, null, "the fallback keeps readSession's token-shape gate");
  assert.equal(pendingCookieMigration(request), null, "the dead request marks nothing");
});

test("the funnel hook is structural: worker imports the auth export and wraps the one route answer", () => {
  assert.match(WORKER_SOURCE, /import \{ pendingCookieMigration \} from "\.\/api\/core\/auth\.mjs"/);
  assert.match(WORKER_SOURCE, /withPendingCookieMigration\(\s*request,\s*await answerApiRoute/);
});
