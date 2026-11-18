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

// The Kitskey vendor pin (the framework migration): api/vendor/ is NOT an
// app-owned copy of the framework — each vendored file must be byte-identical
// to the Project Kitskey source it vendors, in the sibling checkout (the kit
// clone: /Users/itswempo/project-kitskey on this machine — historically named
// project-designer; FORUM_KITSKEY_DIR overrides it for CI or moved checkouts,
// mirroring GooberCord's GC_KITSKEY_DIR law). A drift in EITHER direction
// fails here: copy a framework change in deliberately (vendor the file, run
// the suite), or copy an app-side fix upstream to the framework — never edit
// the vendored file in place.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KITSKEY_DIR = path.resolve(
  process.env.FORUM_KITSKEY_DIR || path.resolve(HERE, "..", "..", "project-kitskey"),
  "experience",
);
const VENDOR_DIR = path.resolve(HERE, "..", "api", "vendor");

// The vendored-file ledger: every file in api/vendor/ gets a byte-pin line
// here, keyed to its source NAME inside experience/. A new vendor phase adds
// its line in the same commit.
const VENDORED = [
  ["http.mjs", "http.mjs"],
  ["db.mjs", "db.mjs"],
];

for (const [vendoredName, sourceName] of VENDORED) {
  test(`api/vendor/${vendoredName} is byte-identical to the Kitskey framework source`, () => {
    assert.equal(
      readFileSync(path.join(VENDOR_DIR, vendoredName), "utf8"),
      readFileSync(path.join(KITSKEY_DIR, sourceName), "utf8"),
    );
  });
}

test("the vendored-file ledger covers every .mjs file in api/vendor/", () => {
  const onDisk = readdirSync(VENDOR_DIR).filter((name) => name.endsWith(".mjs"));
  assert.deepEqual(onDisk.sort(), VENDORED.map(([name]) => name).sort(),
    "a vendored file without a ledger line is drifting un-pinned");
});

// The vendored module's HttpError must be THE HttpError the app throws and
// classifies: core/http.mjs re-exports the vendor class, and worker.mjs's
// errorReply (the vendor import) does the classification against the SAME
// class — so the re-export chain, not a second class, is what keeps the
// 500/4xx classification alive after the migration.
test("core/http.mjs re-exports the vendored HttpError (one class, not a twin)", async () => {
  const vendor = await import("../api/vendor/http.mjs");
  const core = await import("../api/core/http.mjs");
  assert.equal(core.HttpError, vendor.HttpError);
  const error = new core.HttpError(418, "teapot");
  assert.equal(core.errorReply(error).status, 418, "the vendor classifier classifies the re-exported class");
});

// The vendor surface's behavior through the re-exports: the config-bound
// half carries the forum's limiter map (scope -> binding name), and the
// error/response vocabulary behaves exactly as before the migration — a
// failed limiter lookup is the hard 503, a non-HttpError is the shared 500.
test("the migrated core leaf answers through the vendor vocabulary", async () => {
  const core = await import("../api/core/http.mjs");
  const response = core.json({ ok: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");

  const limiterless = { RATE_LIMITS: undefined };
  await assert.rejects(
    core.rateLimit(new Request("https://wempos-forum.itswempo.workers.dev/"), limiterless, "login"),
    (error) => error instanceof core.HttpError && error.status === 503,
    "a missing limiter stays the hard 503, never a silently unlimited route",
  );

  const fallback = core.errorReply(new Error("boom"), "Test:");
  assert.equal(fallback.status, 500, "a non-HttpError takes the shared 500");
});

// --- phase 3 (experience/db): the cursors + block-gate core leaves ----------

// Consumer-shape pins: the core leaves are re-export seams, not re-copies —
// the codec block and the SQL blocks must live only in the vendor file.
test("core/cursors.mjs re-exports the codecs instead of re-copying them", () => {
  const core = readFileSync(path.resolve(HERE, "..", "api", "core", "cursors.mjs"), "utf8");
  assert.ok(!core.includes("export function"), "the codec bodies must come from the vendor");
  assert.match(core, /export \{\s*parseActivityCursor,[\s\S]*from "\.\.\/vendor\/db\.mjs"/);
});

test("core/blocks.mjs binds the app's gate instead of re-copying it", () => {
  const core = readFileSync(path.resolve(HERE, "..", "api", "core", "blocks.mjs"), "utf8");
  assert.ok(!core.includes("SELECT 1 FROM blocks"), "the SQL bodies must come from the vendor");
  assert.match(core, /makeBlockGate\(\{ table: "blocks" \}\)/);
  assert.match(core, /from "\.\.\/vendor\/db\.mjs"/);
});

// Behavior through the seams: the wire formats and the wall behave exactly as
// before (the deep pins live in tests/cursors.test.mjs and
// tests/blocks-module.test.mjs; these hold the seam itself together).
test("the re-exported cursor codecs round-trip, and the gate SQL rides the vendor", async () => {
  const cursors = await import("../api/core/cursors.mjs");
  assert.deepEqual(
    cursors.parseActivityCursor(cursors.encodeActivityCursor({ pinned_at: null, last_activity_at: 1729000000, id: 42 })),
    { rank: 1, seconds: 1729000000, id: 42 },
    "the re-export seam round-trips the ranked activity cursor",
  );
  assert.equal(cursors.encodeScoreCursor({ like_count: 3, dislike_count: 5, id: 9 }), "-2_9");

  const blocks = await import("../api/core/blocks.mjs");
  const seen = [];
  const env = {
    FORUM_DB: {
      prepare(sql) {
        return {
          bind(...values) {
            seen.push({ sql, values });
            return { first: async () => ({ "1": 1 }), all: async () => ({ results: [{ id: 7 }, { id: 12 }] }) };
          },
        };
      },
    },
  };
  assert.equal(await blocks.blockPairExists(env, 4, 11), true);
  assert.deepEqual(await blocks.blockedIdList(env, 4), [7, 12], "blocked ids are Number-coerced as before");
  assert.match(seen[1].sql, /FROM blocks WHERE blocker_id = \?1/, "the table rides the gate's config");
  assert.equal(blocks.viewerBlockFilterSql({ id: 9, role: "admin" }, "author_id"), "",
    "staff reads bypass the wall, exactly as before the migration");
  assert.equal(blocks.viewerBlockFilterSql({ id: 9, role: "member" }, "author_id"), blocks.blockFilterSql("author_id"));
});
