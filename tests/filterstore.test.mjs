// Filter store (v4.3): the D1-stored filter list + desk editing. The pure
// helpers pin here with a fake site_settings table — the source states
// (secret fallback, D1 override) and the entry-splitting the bulk-add reuses.
// The HTTP routes are thin auth wrappers over these helpers (requireStaff +
// one SQL statement each) and follow the desk route shape pinned elsewhere.
import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../api/filterstore.mjs";
import { splitFilterEntries } from "../api/filter.mjs";

// A minimal site_settings stand-in: the exact statements the store issues.
function fakeDb(rows) {
  const table = new Map(rows);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          const [key] = this.args;
          return table.has(key) ? { ...table.get(key) } : null;
        },
        async run() {
          const [key, value, updated_at] = this.args;
          table.set(key, { value, updated_at });
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

test("filterstore.mjs exports the priming, reading, and route surface", () => {
  assert.equal(typeof store.ensureFilterWords, "function");
  assert.equal(typeof store.filterWords, "function");
  assert.equal(typeof store.filterWordsSource, "function");
  assert.equal(typeof store.handleFilterAdminRoutes, "function");
  assert.equal(store.FILTER_MAX_BYTES, 256 * 1024);
});

test("filter source: the secret serves until a D1 row exists, then D1 wins", async () => {
  // Fresh fake env with no "filtered_words" row — the secret (if set) serves.
  const env = { FORUM_DB: fakeDb([]), FILTERED_WORDS: "zab,qux" };
  await store.ensureFilterWords(env);
  assert.equal(store.filterWords(env), "zab,qux");
  assert.equal(store.filterWordsSource(env), "secret");

  // No secret either: the filter is off but still readable.
  const bare = { FORUM_DB: fakeDb([]) };
  store.ensureFilterWords(bare); // async, no await needed for the assertion order below
  assert.equal(await store.ensureFilterWords(bare), undefined);
  assert.equal(store.filterWords(bare), "");
  assert.equal(store.filterWordsSource(bare), "none");
});

test("filter source: an existing D1 row overrides the secret (even empty)", async () => {
  const env = {
    FORUM_DB: fakeDb([["filtered_words", { value: "zab", updated_at: 1730000000 }]]),
    FILTERED_WORDS: "zab,qux",
  };
  await store.ensureFilterWords(env);
  assert.equal(store.filterWords(env), "zab");
  assert.equal(store.filterWordsSource(env), "database");
});

test("bulk-add parsing: newlines, commas, pattern lines, escapes", () => {
  // Same splitting rules the filter compiler uses, so what the desk parses is
  // what the filter reads. The \, escape keeps one literal comma (the line
  // falls back to comma-splitting when its pattern compile fails).
  assert.deepEqual(
    splitFilterEntries(["zab", "apple,apple", "banana,qu\\,x"].join("\n")),
    ["zab", "apple", "apple", "banana", "qu\\,x"],
  );
  // A comma-bearing line that compiles as a pattern stays whole.
  assert.deepEqual(splitFilterEntries("/z[a, b]+/"), ["/z[a, b]+/"]);
  // Globs with commas inside stay glob-shaped lines only via regex hints —
  // plain globs split on commas like words.
  assert.deepEqual(splitFilterEntries("*zippet*,bibi*"), ["*zippet*", "bibi*"]);
});
