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

// Wave 5.22 fuzz lane: property tests (fast-check, fixed seed, bounded runs)
// that throw random and malformed input at the pure validators. Properties:
// never throws, only ever answers the documented shapes, and the URL helpers
// only ever hand back an https:// URL or their fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { isValidUsername } from "../api/core/shapers.mjs";
import { routeForPath } from "../public/js/router.js";
import {
  base32Encode, normalizeTotpAlgorithm, verifyTotpCode, totpAt,
} from "../api/core/totp.mjs";
import { httpsUrlOrEmpty, sourceUrl } from "../api/core/source-url.mjs";
import { safeSourceUrl, DEFAULT_SOURCE_URL } from "../public/js/source-link.js";
import { maskedExcerpt, maskSpoilers } from "../public/js/markdown.js";

// Fixed seed: a failure reproduces exactly. numRuns stays small (machine-load
// law: the whole fuzz set must add well under 15 s to `pnpm test`).
const FUZZ = Object.freeze({ seed: 522, numRuns: 300 });
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;

const ROUTE_NAMES = new Set([
  "setup", "home", "admin", "notifications", "bookmarks", "category", "archive",
  "mine", "leaderboard", "rules", "not-found", "post", "profile", "search",
]);

// Strings that lean on the characters each parser cares about.
const urlish = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc.webUrl({ withFragments: true, withQueryParameters: true }),
  fc.constantFrom(
    "javascript:alert(1)", "JaVaScRiPt:x", "data:text/html,x", "//evil.example",
    "http://example.com", "https://user:pw@example.com", "https://@example.com",
    "  https://example.com/a b  ", "https:example.com", "HTTPS://EXAMPLE.COM",
    "https://", "https://[::1]/", "https://example.com/\"><script>", "\u0000https://x",
    "ftp://example.com", "blob:https://example.com/x", "https://exa%00mple.com",
  ),
  fc.tuple(fc.constantFrom("https://", "http://", "HTTPS://", "", "//"), fc.string())
    .map(([scheme, rest]) => scheme + rest),
);

const pathish = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc.tuple(
    fc.constantFrom("/", "/users/", "/posts/", "/c/", "/admin/", "/admin", "/bookmarks", "//", ""),
    fc.string({ unit: fc.constantFrom("%", "E", "0", "F", "/", "a", "-", "_", "é", "\uD800", "9") }),
  ).map(([lead, rest]) => lead + rest),
  fc.constantFrom("/users/%", "/users/%E0%A4%A", "/users/%FF", "/c/constructor", "/c/__proto__",
    "/posts/99999999999999999999999", "/admin/../setup", "/c/general/", "/?q=%"),
);

const searchish = fc.oneof(
  fc.string(),
  fc.tuple(fc.constantFrom("?view=", "?q=", "?board=", "?", ""), fc.string())
    .map(([lead, rest]) => lead + rest),
  fc.constantFrom("?view=new", "?view=unanswered", "?board=constructor", "?q=%", "?q=%%%"),
);

function assertHttpsOrFallback(value, fallback) {
  assert.equal(typeof value, "string");
  if (value === fallback) return;
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:", value);
  assert.ok(value.startsWith("https://"), value);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
}

test("fuzz isValidUsername: any value → boolean, true only for the documented shape", () => {
  fc.assert(fc.property(fc.oneof(fc.anything(), fc.string(), fc.string({ unit: "binary" })), (value) => {
    const valid = isValidUsername(value);
    assert.equal(typeof valid, "boolean");
    if (valid) assert.ok(typeof value === "string" && USERNAME_PATTERN.test(value));
  }), FUZZ);
});

test("fuzz routeForPath: any path/search → a known route object, never a throw", () => {
  fc.assert(fc.property(pathish, searchish, (pathname, search) => {
    const route = routeForPath(pathname, search);
    assert.equal(typeof route, "object");
    assert.ok(ROUTE_NAMES.has(route.name), JSON.stringify(route));
    if (route.name === "post") assert.ok(Number.isFinite(route.id) || route.id === Infinity);
    if (route.name === "profile") assert.equal(typeof route.username, "string");
    if (route.name === "search") assert.ok(route.query.length > 0);
  }), FUZZ);
});

test("fuzz normalizeTotpAlgorithm: only the exact string SHA256 opts in, all else is SHA1", () => {
  fc.assert(fc.property(fc.oneof(fc.anything(), fc.constantFrom("sha256", "SHA-256", " SHA256", "SHA512")), (value) => {
    const algorithm = normalizeTotpAlgorithm(value);
    assert.equal(algorithm, value === "SHA256" ? "SHA256" : "SHA1");
  }), FUZZ);
});

test("fuzz verifyTotpCode: junk codes resolve false, never reject", async () => {
  const secret = base32Encode(new Uint8Array(20).fill(7));
  const codeish = fc.oneof(
    fc.anything(),
    fc.string(),
    fc.stringMatching(/^\d{1,8}$/),
    fc.constantFrom(" 123456", "123456\n", "12345", "1234567", "١٢٣٤٥٦", "12345\u0000"),
  );
  await fc.assert(fc.asyncProperty(
    codeish,
    fc.oneof(fc.integer(), fc.double(), fc.constant(Number.NaN)),
    fc.oneof(fc.anything(), fc.constantFrom("SHA1", "SHA256")),
    async (code, time, algorithm) => {
      const verdict = await verifyTotpCode(secret, code, time, algorithm);
      assert.equal(typeof verdict, "boolean");
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) assert.equal(verdict, false);
    },
  ), { ...FUZZ, numRuns: 150 });
});

test("fuzz verifyTotpCode: the current code always verifies for any secret and algorithm", async () => {
  await fc.assert(fc.asyncProperty(
    fc.uint8Array({ minLength: 1, maxLength: 40 }),
    fc.integer({ min: 0, max: 4_000_000_000 }),
    fc.constantFrom("SHA1", "SHA256"),
    async (bytes, time, algorithm) => {
      const secret = base32Encode(bytes);
      const code = await totpAt(secret, time, 6, algorithm);
      assert.equal(await verifyTotpCode(secret, code, time, algorithm), true);
    },
  ), { ...FUZZ, numRuns: 60 });
});

test("fuzz httpsUrlOrEmpty: any value → '' or a credential-free https:// URL", () => {
  fc.assert(fc.property(fc.oneof(fc.anything(), urlish), (value) => {
    assertHttpsOrFallback(httpsUrlOrEmpty(value), "");
  }), FUZZ);
});

test("fuzz sourceUrl: any env → '' or a credential-free https:// URL", () => {
  const envish = fc.oneof(
    fc.anything(),
    fc.record({
      SOURCE_URL: fc.oneof(fc.anything(), urlish),
      COMMIT_SHA: fc.oneof(fc.anything(), fc.string(), fc.stringMatching(/^[0-9a-fA-F]{5,42}$/)),
    }, { requiredKeys: [] }),
  );
  fc.assert(fc.property(envish, (env) => {
    assertHttpsOrFallback(sourceUrl(env), "");
  }), FUZZ);
});

test("fuzz safeSourceUrl: any value → the fallback or a credential-free https:// URL", () => {
  fc.assert(fc.property(fc.oneof(fc.anything(), urlish), (value) => {
    assertHttpsOrFallback(safeSourceUrl(value), DEFAULT_SOURCE_URL);
  }), FUZZ);
});

test("fuzz maskedExcerpt: bounded length, no split surrogate, a prefix of the masked text", () => {
  fc.assert(fc.property(
    fc.oneof(fc.string({ maxLength: 400 }), fc.string({ unit: "binary", maxLength: 400 }),
      fc.string({ unit: fc.constantFrom("|", "a", " ", "\n", "`", "\uD83D", "\uDE00", "*"), maxLength: 400 })),
    fc.integer({ min: 1, max: 500 }),
    (text, max) => {
      const excerpt = maskedExcerpt(text, max);
      const masked = maskSpoilers(text);
      assert.ok(excerpt.length <= max + 1);
      if (masked.length <= max) {
        assert.equal(excerpt, masked);
        return;
      }
      assert.ok(excerpt.endsWith("…"));
      const kept = excerpt.slice(0, -1);
      assert.ok(masked.startsWith(kept));
      if (kept.length > 0) {
        const last = kept.charCodeAt(kept.length - 1);
        assert.ok(!(last >= 0xd800 && last <= 0xdbff), "cut inside a surrogate pair");
      }
    },
  ), FUZZ);
});

test("fuzz maskedExcerpt: a ||spoiler|| between plain words never leaks a secret character", () => {
  const plain = fc.string({ unit: fc.constantFrom("a", "b", " ", "1", ".", "\n"), maxLength: 80 });
  const secret = fc.string({ unit: fc.integer({ min: 0x4e00, max: 0x9dff }).map((code) => String.fromCharCode(code)), minLength: 1, maxLength: 40 });
  fc.assert(fc.property(plain, secret, plain, fc.integer({ min: 1, max: 200 }), (before, hidden, after, max) => {
    const excerpt = maskedExcerpt(before + " ||" + hidden + "|| " + after, max);
    for (const ch of hidden) assert.ok(!excerpt.includes(ch), "leaked " + ch);
  }), FUZZ);
});
