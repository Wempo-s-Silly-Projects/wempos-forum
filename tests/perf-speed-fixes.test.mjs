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

// Speed fixes (perf seat, Site Health: thread TTFB ~3 s): the thread page's
// independent D1 reads overlap instead of queueing; the post detail read
// moves its view-count UPDATE onto waitUntil; the client paints replies
// without waiting on the tags read. Every visibility check stays.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { forgeSession, makeRequest, seedPost, seedUser } from "./helpers/seed.mjs";

const QUERY_DELAY_MS = 5;
const EXEC_METHODS = new Set(["first", "all", "run", "raw"]);

// Wraps env.FORUM_DB so each statement takes QUERY_DELAY_MS and the peak
// number of statements in flight at once is recorded.
function probeDb(db) {
  const stats = { inflight: 0, peak: 0, sql: [] };
  const wrapStatement = (statement) => new Proxy(statement, {
    get(target, key) {
      if (key === "bind") return (...values) => wrapStatement(target.bind(...values));
      if (EXEC_METHODS.has(key)) {
        return async (...args) => {
          stats.inflight += 1;
          stats.peak = Math.max(stats.peak, stats.inflight);
          stats.sql.push(target.sql);
          try {
            await new Promise((resolve) => setTimeout(resolve, QUERY_DELAY_MS));
            return await target[key](...args);
          } finally {
            stats.inflight -= 1;
          }
        };
      }
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const wrapped = new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql) => wrapStatement(target.prepare(sql));
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: wrapped, stats };
}

async function world() {
  const env = makeEnv({});
  const sqlite = env.__sqlite;
  const alice = await seedUser(sqlite, { username: "alice" });
  const bob = await seedUser(sqlite, { username: "bob" });
  const root = seedPost(sqlite, { authorId: alice, body: "A speedy thread title\nwith a body" });
  seedPost(sqlite, { authorId: bob, body: "a reply", parentId: root });
  const hidden = seedPost(sqlite, { authorId: alice, body: "SECRET hidden words", visibility: "hidden" });
  return { env, sqlite, alice, bob, root, hidden };
}

const htmlPage = (path, session) => makeRequest(path, { headers: { Accept: "text/html" }, session });

test("thread HTML: independent D1 reads run concurrently (shell metas + SEO head)", async () => {
  const w = await world();
  const { db, stats } = probeDb(w.env.FORUM_DB);
  const env = { ...w.env, FORUM_DB: db };
  const session = forgeSession(w.sqlite, w.bob);
  const res = await worker.fetch(htmlPage("/posts/" + w.root, session), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>A speedy thread title/);
  assert.ok(stats.peak >= 2, "reads overlap: peak in flight was " + stats.peak);
});

test("thread HTML: the visibility law holds with concurrent reads (hidden post -> generic noindexed head)", async () => {
  const w = await world();
  const { db } = probeDb(w.env.FORUM_DB);
  const env = { ...w.env, FORUM_DB: db };
  for (const session of [null, forgeSession(w.sqlite, w.bob)]) {
    const html = await (await worker.fetch(htmlPage("/posts/" + w.hidden, session || undefined), env, { waitUntil() {} })).text();
    assert.doesNotMatch(html, /SECRET/);
    assert.match(html, /<meta name="robots" content="noindex">/);
  }
});

test("GET /api/posts/:id: the view-count UPDATE rides waitUntil, never the response path", { timeout: 5000 }, async () => {
  const w = await world();
  // The UPDATE is held open until released: the response must not wait on it.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const original = w.env.FORUM_DB;
  const holding = new Proxy(original, {
    get(target, key) {
      if (key === "prepare") {
        return (sql) => {
          const statement = target.prepare(sql);
          if (!/UPDATE posts SET view_count/.test(sql)) return statement;
          return { bind: (...values) => ({ first: async () => { await held; return statement.bind(...values).first(); } }) };
        };
      }
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const tasks = [];
  const res = await worker.fetch(makeRequest("/api/posts/" + w.root), { ...w.env, FORUM_DB: holding },
    { waitUntil: (task) => tasks.push(task) });
  assert.equal(res.status, 200, "the response returned while the UPDATE was still held");
  const body = await res.json();
  assert.equal(body.viewCount, 1, "the payload still counts this view");
  assert.ok(tasks.length >= 1, "the increment was handed to waitUntil");
  assert.equal(w.sqlite.prepare("SELECT view_count AS n FROM posts WHERE id = ?").get(w.root).n, 0);
  release();
  await Promise.all(tasks);
  assert.equal(w.sqlite.prepare("SELECT view_count AS n FROM posts WHERE id = ?").get(w.root).n, 1);
});

test("GET /api/posts/:id: an author's own view schedules no increment; a failed increment is logged, not thrown", async () => {
  const w = await world();
  const tasks = [];
  const own = await worker.fetch(makeRequest("/api/posts/" + w.root, { session: forgeSession(w.sqlite, w.alice) }),
    w.env, { waitUntil: (task) => tasks.push(task) });
  assert.equal(own.status, 200);
  await Promise.all(tasks);
  assert.equal(w.sqlite.prepare("SELECT view_count AS n FROM posts WHERE id = ?").get(w.root).n, 0);

  const original = w.env.FORUM_DB;
  const failing = new Proxy(original, {
    get(target, key) {
      if (key === "prepare") {
        return (sql) => (/UPDATE posts SET view_count/.test(sql)
          ? { bind: () => ({ first: async () => { throw new Error("simulated D1 outage"); } }) }
          : target.prepare(sql));
      }
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const later = [];
    const res = await worker.fetch(makeRequest("/api/posts/" + w.root), { ...w.env, FORUM_DB: failing },
      { waitUntil: (task) => later.push(task) });
    assert.equal(res.status, 200);
    await Promise.all(later);
  } finally {
    console.error = originalError;
  }
  assert.ok(logged.some((line) => /view count/i.test(line)), "the failure is logged");
});

test("wrangler.toml and the example both turn on Smart Placement (top level, before [vars])", () => {
  for (const file of ["wrangler.toml", "wrangler.example.toml"]) {
    const toml = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.match(toml, /^\[placement\]\nmode = "smart"$/m, file);
    assert.ok(toml.indexOf("[placement]") < toml.indexOf("[vars]"), file + ": a top-level table, not inside an env block");
  }
});

test("post.js: the tags read never blocks painting the replies", () => {
  const source = readFileSync(new URL("../public/js/routes/post.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("async function renderPostRoute"), source.indexOf("\n}\n", source.indexOf("async function renderPostRoute")));
  assert.doesNotMatch(render, /await\s+appendThreadTags/, "appendThreadTags is started, not awaited inline");
  const tagsAwait = render.search(/await\s+tagsReady/);
  const repliesPaint = render.indexOf("main.append(replyList)");
  assert.ok(repliesPaint > 0 && tagsAwait > repliesPaint, "any wait on tags comes after the replies are painted");
});
