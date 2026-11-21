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
// Wave 2026-11-21-35 F1 — hostile-cursor sweep over every /api/posts variant
// (activity, category, Suggestions score, Newest bare id, Unanswered, My
// posts, signed-in with a block pair). Each request must answer 200 or 400 —
// never 500 — every statement must bind under D1's 100-parameter ceiling, and
// no 200 page may carry a hidden root or a banned author's root. A seeded
// mulberry32 generator keeps the sweep reproducible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { D1_MAX_BOUND_PARAMS } from "../constants.mjs";

const FUZZ_PER_VARIANT = 220;
const ROOTS_PER_BOARD = 25;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATOMS = ["0", "1", "-", "_", "__", ".", "e", "E", "+", " ", "%", "\u0000", "NaN", "Infinity",
  "-Infinity", "0x1f", "9007199254740993", "99999999999", "1e309", "١٢", "​", ",", ";", "=", "&",
  "?", "/", "'", "\"", "--", "OR 1=1", "null", "undefined", "[]", "{}", "~", "\n"];

function randomDigits(rand) {
  const length = Math.floor(rand() * 22);
  let out = "";
  for (let i = 0; i < length; i += 1) out += String(Math.floor(rand() * 10));
  return out;
}

function randomCursor(rand) {
  const parts = 1 + Math.floor(rand() * 5);
  let out = "";
  for (let i = 0; i < parts; i += 1) {
    if (i > 0) out += rand() < 0.75 ? "_" : ATOMS[Math.floor(rand() * ATOMS.length)];
    out += rand() < 0.6 ? (rand() < 0.2 ? "-" : "") + randomDigits(rand) : ATOMS[Math.floor(rand() * ATOMS.length)];
  }
  return out;
}

// Hand-picked shapes: wrong arity, signs, overflow, separators, and cursors
// minted by one view replayed on another.
const FIXED = ["", "_", "1_", "_1", "1__1", "1_2_3_4", "2_1_1", "0_0_0", "1_0_0", "-1_5", "1_-5",
  "-0_1", "0_1", "-9999999999_1", "1_9999999999", "99999999999_1", "1_99999999999",
  "9007199254740993", "9007199254740993_1", "1e3_1", "Infinity_1", "NaN_NaN", " 1_1", "1_1 ",
  "1.5_2", "0x10_1", "1,2", "1;2", "12", "0", "000000000000000", "1234567890123456",
  "1_1700000000_5", "0_1700000000_5", "1700000000_5", "3_5", "-3_5"];

const VARIANTS = [
  "/api/posts?",
  "/api/posts?board=help&",
  "/api/posts?board=suggestions&",
  "/api/posts?sort=new&",
  "/api/posts?sort=new&board=help&",
  "/api/posts?unanswered=1&",
  "/api/posts?unanswered=1&board=suggestions&",
  "/api/posts?unanswered=1&sort=new&board=general&",
];

function spyBinds(env) {
  const real = env.FORUM_DB;
  const counts = [];
  const db = {
    prepare(sql) {
      const statement = real.prepare(sql);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        counts.push(values.length);
        return bind(...values);
      };
      return statement;
    },
    batch: (statements) => real.batch(statements),
    exec: (sql) => real.exec(sql),
  };
  return { env: { ...env, FORUM_DB: db }, counts };
}

async function seedWorld() {
  const base = makeEnv();
  const db = base.__sqlite;
  const viewer = await seedUser(db, { username: "viewer" });
  const author = await seedUser(db, { username: "author" });
  const banned = await seedUser(db, { username: "banned" });
  const blocked = await seedUser(db, { username: "blocked" });
  seedBan(db, banned);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
    .run(viewer, blocked, now());
  for (const board of ["general", "help", "suggestions"]) {
    for (let i = 0; i < ROOTS_PER_BOARD; i += 1) {
      const id = seedPost(db, { authorId: i % 5 === 0 ? viewer : author, body: board + i, board });
      if (i % 3 === 0) seedPost(db, { authorId: author, body: "re", parentId: id });
    }
  }
  const forbidden = new Set([
    seedPost(db, { authorId: author, body: "hidden root", visibility: "hidden" }),
    seedPost(db, { authorId: banned, body: "banned root" }),
    seedPost(db, { authorId: banned, body: "banned idea", board: "suggestions" }),
    seedPost(db, { authorId: author, body: "hidden idea", visibility: "hidden", board: "suggestions" }),
  ]);
  const blockedRoot = seedPost(db, { authorId: blocked, body: "blocked root" });
  const session = forgeSession(db, viewer);
  const { env, counts } = spyBinds(base);
  return { env, counts, forbidden, blockedRoot, session };
}

async function sweep(world, path, options) {
  world.counts.length = 0;
  const res = await call(world.env, path, options);
  assert.ok(res.status === 200 || res.status === 400, path + " answered " + res.status);
  const worst = Math.max(0, ...world.counts);
  assert.ok(worst < D1_MAX_BOUND_PARAMS, path + " bound " + worst + " params");
  if (res.status !== 200) return { status: res.status };
  const body = await res.json();
  for (const post of body.posts) {
    assert.ok(!world.forbidden.has(post.id), path + " leaked post " + post.id);
    if (options && options.session) assert.notEqual(post.id, world.blockedRoot, path + " leaked a blocked root");
  }
  return { status: 200, body };
}

test("cursor fuzz: 200+ hostile cursors per feed variant answer 200/400 under the bind ceiling", async () => {
  const world = await seedWorld();
  const rand = mulberry32(0x35c0ffee);
  let requests = 0;
  const tally = { 200: 0, 400: 0 };
  for (const [index, variant] of VARIANTS.entries()) {
    const cursors = [...FIXED];
    while (cursors.length < FUZZ_PER_VARIANT) cursors.push(randomCursor(rand));
    for (const cursor of cursors) {
      // Alternate anonymous and signed-in (block pair armed) viewers.
      const options = (requests + index) % 2 === 0 ? undefined : { session: world.session };
      const { status } = await sweep(world, variant + "before=" + encodeURIComponent(cursor), options);
      tally[status] += 1;
      requests += 1;
    }
  }
  assert.ok(requests >= VARIANTS.length * 200, "ran " + requests);
  assert.ok(tally[400] > 0 && tally[200] > 0, JSON.stringify(tally));
});

test("cursor fuzz: My posts bare-id cursor survives the same sweep", async () => {
  const world = await seedWorld();
  const rand = mulberry32(0x35);
  const cursors = [...FIXED];
  while (cursors.length < FUZZ_PER_VARIANT) cursors.push(randomCursor(rand));
  for (const cursor of cursors) {
    await sweep(world, "/api/posts?mine=1&before=" + encodeURIComponent(cursor), { session: world.session });
  }
});

test("cross-view cursors: each view refuses the others' shapes or restarts safely", async () => {
  const world = await seedWorld();
  // Mint one real cursor per view, then replay it on every other view.
  const minted = {};
  for (const [name, path] of [["activity", "/api/posts"], ["score", "/api/posts?board=suggestions"],
    ["newest", "/api/posts?sort=new"]]) {
    const { body } = await sweep(world, path);
    assert.ok(body.nextBefore !== null, name + " should paginate");
    minted[name] = String(body.nextBefore);
  }
  assert.match(minted.activity, /^[01]_[0-9]+_[0-9]+$/);
  assert.match(minted.score, /^-?[0-9]+_[0-9]+$/);
  assert.match(minted.newest, /^[0-9]+$/);
  // A ranked activity cursor is not a score cursor; a bare id is neither.
  assert.equal((await sweep(world, "/api/posts?board=suggestions&before=" + minted.activity)).status, 400);
  assert.equal((await sweep(world, "/api/posts?before=" + minted.newest)).status, 400);
  assert.equal((await sweep(world, "/api/posts?board=suggestions&before=" + minted.newest)).status, 400);
  assert.equal((await sweep(world, "/api/posts?sort=new&before=" + minted.activity)).status, 400);
  assert.equal((await sweep(world, "/api/posts?sort=new&before=" + minted.score)).status, 400);
  // A score cursor on an activity feed parses as the legacy 2-part form:
  // a 200 that stays inside the visibility law (checked by sweep).
  assert.equal((await sweep(world, "/api/posts?board=help&before=" + minted.score)).status, 200);
});

test("param combos: unknown values and forbidden pairings 400, repeats take the first", async () => {
  const world = await seedWorld();
  const expect = [
    ["/api/posts?unanswered=1&sort=new&board=suggestions", 400],
    ["/api/posts?sort=new&board=suggestions", 400],
    ["/api/posts?sort=old", 400],
    ["/api/posts?sort=", 400],
    ["/api/posts?unanswered=true", 400],
    ["/api/posts?unanswered=", 400],
    ["/api/posts?mine=1&sort=new", 400],
    ["/api/posts?board=nope", 400],
    ["/api/posts?board=help&board=suggestions&sort=new", 200],
    ["/api/posts?sort=new&sort=bogus", 200],
    ["/api/posts?unanswered=1&unanswered=2", 200],
    ["/api/posts?view=%3Cscript%3E&unanswered=0", 200],
    ["/api/posts?unanswered=1&board=suggestions", 200],
    ["/api/posts?board=", 200],
  ];
  for (const [path, status] of expect) {
    assert.equal((await sweep(world, path, { session: world.session })).status, status, path);
  }
});
