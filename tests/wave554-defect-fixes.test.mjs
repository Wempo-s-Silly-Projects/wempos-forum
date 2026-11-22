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

// v5.54 defect fixes from the v5.45/v5.49/v5.53 security reviews. M1 and L1
// were `todo` pins in tests/wave545-security-review.test.mjs and
// tests/wave549-security-review.test.mjs (now real tests); this file adds the
// MCP twin and plan/bind pins for M1, the note/saved-search control-character
// rules for L1, the edit-history diff budget (M2) and the lock upsert's root
// re-check (L2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { bestOf } from "./helpers/timing.mjs";
import { D1_MAX_BOUND_PARAMS, THREAD_REPLY_INSERT_SQL, THREAD_REPLY_INSERT_STAGED_SQL } from "../constants.mjs";
import { SLOW_MODE_CHECK_SQL, SLOW_MODE_INSERT_GUARD_SQL } from "../api/staff-tools.mjs";
import { DIFF_MAX_WORDS } from "../public/js/word-diff.js";
import { renderEditHistoryPanel } from "../public/js/render.js";

const AGENT_TOKEN = "w554-agent-token-0123456789abcdefghijklmn";

async function world() {
  const env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(AGENT_TOKEN)]: "bob" }) });
  const db = env.__sqlite;
  const id = {
    boss: await seedUser(db, { username: "boss", role: "admin" }),
    alice: await seedUser(db, { username: "alice" }),
    bob: await seedUser(db, { username: "bob" }),
  };
  const root = seedPost(db, { authorId: id.alice, body: "w554 thread root" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, root, session };
}

const count = (db, sql, ...args) => Number(db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n);
const slowMode = (w, seconds = 900) =>
  w.db.prepare("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, ?, ?, ?)").run(w.root, seconds, w.id.boss, now());
const replyPost = (env, postId, body, session) =>
  call(env, "/api/posts/" + postId + "/replies", { method: "POST", body: { body }, session });

async function mcpReply(env, postId, body) {
  const res = await call(env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + AGENT_TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reply", arguments: { post_id: postId, body } } }),
  });
  return (await res.json()).result;
}

// The early fast-path read races (stale once); later reads are fresh.
function staleOnce(env, staleSql) {
  const real = env.FORUM_DB;
  let stale = true;
  return {
    ...env,
    FORUM_DB: {
      prepare(sql) {
        if (sql === staleSql && stale) {
          stale = false;
          return { bind: () => ({ first: async () => null }) };
        }
        return real.prepare(sql);
      },
      batch: (statements) => real.batch(statements),
      exec: (sql) => real.exec(sql),
    },
  };
}

function spyBinds(env) {
  const real = env.FORUM_DB;
  const seen = [];
  return {
    seen,
    env: {
      ...env,
      FORUM_DB: {
        prepare(sql) {
          const statement = real.prepare(sql);
          const bind = statement.bind.bind(statement);
          statement.bind = (...values) => {
            seen.push({ sql, binds: values.length });
            return bind(...values);
          };
          return statement;
        },
        batch: (statements) => real.batch(statements),
        exec: (sql) => real.exec(sql),
      },
    },
  };
}

// ---------------------------------------------------------------- M1

test("M1: the MCP reply tool refuses a reply whose cooldown check read stale (exactly one lands)", async () => {
  const w = await world();
  slowMode(w);
  assert.equal((await mcpReply(w.env, w.root, "agent burst 0")).isError, false);
  const raced = await mcpReply(staleOnce(w.env, SLOW_MODE_CHECK_SQL), w.root, "agent burst 1");
  assert.equal(raced.isError, true);
  assert.equal(count(w.db, "posts WHERE body LIKE 'agent burst %'"), 1);
});

test("M1: a burst of stale-read web replies inside one cooldown lands exactly one", async () => {
  const w = await world();
  slowMode(w);
  const bob = w.session("bob");
  const statuses = [];
  for (let i = 0; i < 5; i += 1) {
    statuses.push((await replyPost(staleOnce(w.env, SLOW_MODE_CHECK_SQL), w.root, "web burst " + i, bob)).status);
  }
  assert.deepEqual(statuses, [201, 429, 429, 429, 429]);
  assert.equal(count(w.db, "posts WHERE body LIKE 'web burst %'"), 1);
});

test("M1: staff stay exempt; no slow mode means no refusal", async () => {
  const w = await world();
  const boss = w.session("boss");
  const bob = w.session("bob");
  assert.equal((await replyPost(w.env, w.root, "free 0", bob)).status, 201);
  assert.equal((await replyPost(w.env, w.root, "free 1", bob)).status, 201, "no slow mode, no wait");
  slowMode(w);
  assert.equal((await replyPost(w.env, w.root, "staff 0", boss)).status, 201);
  assert.equal((await replyPost(w.env, w.root, "staff 1", boss)).status, 201, "staff are exempt");
});

test("M1: the guarded reply INSERT binds 15+3 / 16+3 for members, stays at 15 for staff, all < D1_MAX_BOUND_PARAMS", async () => {
  assert.equal((SLOW_MODE_INSERT_GUARD_SQL.match(/\?/g) || []).length, 3);
  assert.equal((THREAD_REPLY_INSERT_SQL.match(/\?/g) || []).length, 15);
  assert.equal((THREAD_REPLY_INSERT_STAGED_SQL.match(/\?/g) || []).length, 16);
  const w = await world();
  slowMode(w, 30);
  const member = spyBinds(w.env);
  assert.equal((await replyPost(member.env, w.root, "bind member", w.session("bob"))).status, 201);
  const memberInsert = member.seen.find((s) => s.sql.startsWith("INSERT INTO posts"));
  assert.equal(memberInsert.binds, 18);
  assert.ok(memberInsert.sql.endsWith(SLOW_MODE_INSERT_GUARD_SQL));
  const staff = spyBinds(w.env);
  assert.equal((await replyPost(staff.env, w.root, "bind staff", w.session("boss"))).status, 201);
  const staffInsert = staff.seen.find((s) => s.sql.startsWith("INSERT INTO posts"));
  assert.equal(staffInsert.binds, 15);
  for (const s of [...member.seen, ...staff.seen]) assert.ok(s.binds < D1_MAX_BOUND_PARAMS, s.binds + " binds");
});

test("M1: the guarded reply INSERT is served by indexes (no table scan)", async () => {
  const w = await world();
  for (const base of [THREAD_REPLY_INSERT_SQL, THREAD_REPLY_INSERT_STAGED_SQL]) {
    const binds = (base.match(/\?/g) || []).length + 3;
    const plan = w.db.prepare("EXPLAIN QUERY PLAN " + base + SLOW_MODE_INSERT_GUARD_SQL).all(...Array(binds).fill(1))
      .map((row) => row.detail).join(" | ");
    assert.doesNotMatch(plan, /\bSCAN (p|par|s|posts|root|thread_slowmode|bans|archived|post_archive)\b(?! USING)/, plan);
  }
});

// ---------------------------------------------------------------- L1

const putNote = (w, body) =>
  call(w.env, "/api/users/bob/note", { method: "PUT", body: { body }, session: w.session("alice") });
const saveSearch = (w, body) =>
  call(w.env, "/api/me/saved-searches", { method: "POST", body, session: w.session("alice") });

test("L1: notes keep line breaks and tabs but refuse other C0/C1 controls with a 400", async () => {
  const w = await world();
  assert.equal((await putNote(w, "line one\nline two\tindented")).status, 200);
  for (const bad of ["a\u0000b", "a\u0001b", "a\rb", "a\u001bb", "a\u007fb", "a\u0085b"]) {
    assert.equal((await putNote(w, bad)).status, 400, JSON.stringify(bad));
  }
});

test("L1: saved-search name and q refuse every C0 control with a 400", async () => {
  const w = await world();
  for (const bad of ["a\u0000b", "a\nb", "a\tb", "a\u001fb", "a\u007fb"]) {
    assert.equal((await saveSearch(w, { name: bad, q: "cats" })).status, 400, "name " + JSON.stringify(bad));
    assert.equal((await saveSearch(w, { name: "ok", q: bad })).status, 400, "q " + JSON.stringify(bad));
  }
  assert.equal(count(w.db, "saved_searches"), 0);
  assert.equal((await saveSearch(w, { name: "cats", q: "cats" })).status, 201);
});

// ---------------------------------------------------------------- M2

const words = (n, prefix = "w") => Array.from({ length: n }, (_, i) => prefix + i).join(" ");
const entriesOf = (panel) => [...panel.children].filter((n) => String(n.className).includes("edit-history-entry"));
const hasMarks = (entry) => {
  const walk = (node) => (node.children ? [...node.children] : []).some((child) =>
    /edit-diff-(ins|del)/.test(String(child.className)) || walk(child));
  return walk(entry);
};

test("M2: a post with 100 worst-case edits renders its panel without diffing all of them", () => {
  const a = words(DIFF_MAX_WORDS);
  const b = words(DIFF_MAX_WORDS, "v");
  const edits = Array.from({ length: 100 }, (_, i) => ({ editedAt: "2026-11-21T12:00:00Z", body: i % 2 ? a : b }));
  let panel;
  const elapsed = bestOf(() => { panel = renderEditHistoryPanel(makeFakeDocument(), edits, a); }, 3, 1500);
  const entries = entriesOf(panel);
  assert.equal(entries.length, 101, "every version still renders");
  const diffed = entries.filter(hasMarks).length;
  assert.ok(diffed <= 2, "diffed " + diffed + " of 101");
  assert.ok(elapsed < 1500, "panel " + elapsed.toFixed(0) + " ms");
  // Past the budget a version shows its plain full text.
  assert.equal(entries[100].textContent.endsWith(edits[99].body), true);
});

test("M2: a panel of many small edits still diffs every version inside the budget", () => {
  const edits = Array.from({ length: 100 }, (_, i) => ({ editedAt: "2026-11-21T12:00:00Z", body: "the quick fox number " + i }));
  const panel = renderEditHistoryPanel(makeFakeDocument(), edits, "the quick fox number now");
  const entries = entriesOf(panel);
  assert.equal(entries.filter(hasMarks).length, 100, "all but the oldest diff");
});

// ---------------------------------------------------------------- L2

test("L2: a lock on a thread deleted between the root check and the upsert answers 404, not 500", async () => {
  const w = await world();
  const ghost = w.root + 1000;
  const real = w.env.FORUM_DB;
  // The root check reads the thread as present; by the upsert it is gone.
  const raced = {
    ...w.env,
    FORUM_DB: {
      prepare(sql) {
        if (sql === "SELECT id, parent_id FROM posts WHERE id = ? LIMIT 1") {
          return { bind: (postId) => ({ first: async () => ({ id: postId, parent_id: null }) }) };
        }
        return real.prepare(sql);
      },
      batch: (statements) => real.batch(statements),
      exec: (sql) => real.exec(sql),
    },
  };
  const res = await call(raced, "/api/admin/threads/" + ghost + "/lock", { method: "PUT", body: { reason: "x" }, session: w.session("boss") });
  assert.equal(res.status, 404);
  assert.equal(count(w.db, "thread_locks"), 0);
  // A live root still locks, and a re-lock still updates in place.
  for (const reason of ["first", "second"]) {
    const ok = await call(w.env, "/api/admin/threads/" + w.root + "/lock", { method: "PUT", body: { reason }, session: w.session("boss") });
    assert.equal(ok.status, 200);
  }
  assert.equal(w.db.prepare("SELECT reason FROM thread_locks WHERE post_id = ?").get(w.root).reason, "second");
});
