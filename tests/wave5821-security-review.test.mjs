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

// v5.82.1 security review of v5.73.2-v5.82.0 (docs/security-review-v5.74-v5.82.md).
// L1 (fixed): the vendored emoji picker (picmo) kept the member's recently
// used emoji under the unscoped localStorage key "PicMo:recents", written
// from vendor code the storage-wipe sweep never scans, so it survived
// sign-out on a shared browser. emoji-picker.js now owns a clearAll that
// the sign-out wipe calls. The rest are regression pins for checks that
// passed: constant-time compare, the profile-CSS sandbox against escapes,
// the CSP (no 'unsafe-*'), the five new migrations (CREATE-only), the
// service worker (never caches /api/ or pages), the Anubis seam (no client
// bypass header), production pinned to ALTCHA, the relay and the vitals
// beacon origin gate, and the export's own-data scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, makeRequest } from "./helpers/seed.mjs";
import worker from "../worker.mjs";
import { equalConstantTime } from "../api/core/crypto.mjs";
import { scopeProfileCss } from "../api/profile-css.mjs";
import { json, secureResponse, securityHeaders } from "../api/core/http.mjs";
import { anubisGate, anubisGateApplies, isTrustedCrawler } from "../api/core/anubis-gate.mjs";
import { humanCheckMode } from "../api/core/human-check.mjs";
import { clearAllEmojiRecents, PICMO_RECENTS_KEY } from "../public/js/emoji-picker.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CTX = { waitUntil() {} };

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    keys: () => [...data.keys()],
  };
}

// ---- L1 (fixed) ----------------------------------------------------------

test("L1: the picmo recents key is the one the vendored picker writes", () => {
  assert.equal(PICMO_RECENTS_KEY, "PicMo:recents");
  assert.match(read("public/js/vendor/picmo.js"), /const G = "PicMo:recents";/);
});

test("L1: clearAllEmojiRecents removes the picker's recents and nothing else", () => {
  const storage = memoryStorage({ [PICMO_RECENTS_KEY]: "[{\"emoji\":\"x\"}]", theme: "dark" });
  clearAllEmojiRecents(storage);
  assert.deepEqual(storage.keys(), ["theme"]);
  assert.doesNotThrow(() => clearAllEmojiRecents(null));
  assert.doesNotThrow(() => clearAllEmojiRecents({ removeItem() { throw new Error("blocked"); } }));
});

test("L1: the sign-out wipe calls clearAllEmojiRecents", () => {
  const nav = read("public/js/routes/account-nav.js");
  assert.match(nav, /import \{ clearAllEmojiRecents \} from "\.\.\/emoji-picker\.js";/);
  const wipe = nav.slice(nav.indexOf("function wipeAccountLocalData()"));
  assert.match(wipe.slice(0, wipe.indexOf("\n}")), /\bclearAllEmojiRecents\(\)/);
});

// ---- regression pins (pass) -----------------------------------------------

test("equalConstantTime: equal strings only; length differences and non-strings refuse", () => {
  assert.equal(equalConstantTime("123456", "123456"), true);
  assert.equal(equalConstantTime("123456", "123457"), false);
  assert.equal(equalConstantTime("123456", "1234567"), false);
  assert.equal(equalConstantTime("", ""), true);
  assert.equal(equalConstantTime("abc", null), false);
  assert.equal(equalConstantTime("é", "é"), false);
});

test("profile CSS: escapes, off-origin url(), @import and expression() never survive", () => {
  const hostile = [
    "a{background:u\\72l(https://evil.example/x)}",
    "a{background:url(https://evil.example/x)}",
    "a{background:url(//evil.example/x)}",
    "a{background:url(javascript:alert(1))}",
    "@import url(/x.css);a{color:red}",
    "@\\69mport url(/x.css);",
    "a{width:expression(alert(1))}",
    "a{color:red;position:fixed}",
  ];
  for (const css of hostile) {
    assert.doesNotMatch(scopeProfileCss(css), /evil|javascript|@import|expression|position/i, css);
  }
  assert.equal(scopeProfileCss("a{color:red} /* unterminated"), "");
  assert.equal(scopeProfileCss("body{color:red}"), ".profile-theme-scope body{color:red}");
});

test("CSP: no 'unsafe-*' or wildcard source on documents or JSON; Turnstile is gone", () => {
  const policies = [
    secureResponse(new Response("x")).headers.get("Content-Security-Policy"),
    json({}).headers.get("Content-Security-Policy"),
    securityHeaders(new Headers()).get("Content-Security-Policy"),
  ];
  for (const csp of policies) {
    assert.ok(csp);
    assert.doesNotMatch(csp, /'unsafe-|challenges\.cloudflare\.com|\s\*/);
  }
});

test("migrations 0079-0087: CREATE-only (no DROP, DELETE, UPDATE, ALTER or INSERT)", () => {
  for (const name of ["0079_web_vitals", "0080_image_dimensions", "0081_account_security",
    "0084_profile_header_styles", "0087_link_previews"]) {
    const statements = read(`migrations/${name}.sql`).replace(/--.*$/gm, "").split(";")
      .map((statement) => statement.trim()).filter(Boolean);
    assert.ok(statements.length > 0, name);
    for (const statement of statements) {
      assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS\b/i, name + ": " + statement.slice(0, 40));
    }
  }
});

test("service worker: never answers /api/ or navigations from cache; refuses HTML and no-store", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)\) return;/);
  assert.match(sw, /request\.mode === "navigate"\) \{\s*event\.respondWith\(networkOrOffline\(request\)\)/);
  assert.match(sw, /no-store\|private/);
  assert.match(sw, /includes\("text\/html"\)/);
});

// v5.83 (real Anubis forward-auth): the gate now forwards an allowlist of
// headers to Anubis, but decides from Accept alone and takes the client IP
// only from CF-Connecting-IP — never from a client-sent X-Wempo-Client-Ip.
test("anubisGate: no client header bypasses the seam; only allowlisted headers are read", async () => {
  const src = read("api/core/anubis-gate.mjs");
  const headerReads = new Set([...src.matchAll(/headers\.get\("([^"]+)"\)/g)].map(([, name]) => name));
  // v5.84.3: User-Agent is read for the good-crawler pass, but a UA alone can
  // never skip the check — Cloudflare's request.cf.asn must match too.
  assert.deepEqual([...headerReads].sort(), ["Accept", "CF-Connecting-IP", "Content-Length", "Cookie", "Location", "User-Agent"]);
  const forgedCrawler = new Request("https://wempos-forum.com/c/general", { headers: { "User-Agent": "Googlebot/2.1 archive.org_bot" } });
  assert.equal(isTrustedCrawler(forgedCrawler), false, "a crawler UA without Cloudflare's network data is not trusted");
  Object.defineProperty(forgedCrawler, "cf", { value: { asn: 13335 } });
  assert.equal(isTrustedCrawler(forgedCrawler), false, "a crawler UA from the wrong network is not trusted");
  assert.doesNotMatch(src, /headers\.get\(ANUBIS_CLIENT_IP_HEADER\)/);
  const request = new Request("https://wempos-forum.com/c/general", {
    headers: { Accept: "text/html", "X-Anubis-Pass": "1", Cookie: "within.website-x-cmd-anubis-auth=forged" },
  });
  assert.equal(anubisGateApplies(request), true);
  assert.equal(await anubisGate(request, {}), null);
});

test("human check: production runs altcha, or anubis only when fully configured; altcha mode refuses a missing proof", async () => {
  // v5.84.1 (owner "switch to ANUBIS"): anubis is allowed in production only
  // with a real https origin and a 64-hex public key beside it; anything else
  // must stay altcha. Never "off".
  const toml = read("wrangler.toml");
  const mode = (toml.match(/^HUMAN_CHECK = "([a-z]+)"$/m) ?? [])[1];
  assert.ok(mode === "altcha" || mode === "anubis", `production HUMAN_CHECK is ${mode}`);
  if (mode === "anubis") {
    assert.match(toml, /^ANUBIS_URL = "https:\/\/[a-z0-9.-]+"$/m);
    assert.match(toml, /^ANUBIS_PUBLIC_KEY_HEX = "[0-9a-f]{64}"$/m);
  }
  assert.equal(humanCheckMode({ HUMAN_CHECK: "altcha" }), "altcha");
  const env = makeEnv({ HUMAN_CHECK: "altcha", ALTCHA_HMAC_KEY: "k".repeat(32) });
  const res = await call(env, "/api/auth/login", { method: "POST", body: { username: "nobody", password: "x" } });
  assert.equal(res.status, 403);
});

test("relay: an unauthenticated call is 403", async () => {
  const env = makeEnv();
  const res = await worker.fetch(new Request("https://wempos-forum.com/api/relay/password-verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "a", password: "b" }),
  }), env, CTX);
  assert.equal(res.status, 403);
});

test("vitals: a cross-origin beacon answers 204 and writes nothing", async () => {
  const env = makeEnv();
  const res = await worker.fetch(makeRequest("/api/vitals", {
    method: "POST", body: { route: "feed", metrics: { LCP: 1000 } }, headers: { Origin: "https://evil.example" },
  }), env, CTX);
  assert.equal(res.status, 204);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM web_vitals_daily").get().n, 0);
});

test("export: the new uploads section reads only the caller's own uploads", () => {
  assert.match(read("api/export.mjs"), /FROM attachments " \+\s*"WHERE created_by = \? AND source_kind <> 'gif'/);
});
