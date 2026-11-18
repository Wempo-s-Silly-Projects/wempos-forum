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

// v4.0 layer guard (plan 1): three structural pins that every core-split
// move must keep true. (1) api/core/ is the bottom of the import ladder —
// its files may import only each other, or the root constants.mjs data
// leaf, judged on RESOLVED paths (a "./"-prefix match alone lets
// "./../shared.mjs" escape, which a reviewer caught before plans 2–6 lean
// on this tripwire). (2) api/core/ must exist — a vanished directory makes
// the scan vacuous. (3) api/shared.mjs's export surface is a compatibility
// contract: worker.mjs re-exports through it and every api module + test
// imports it, so a name may MOVE into core but may never VANISH. The list
// below is the complete surface as of the v4.0 branch point (2dd922f) — if
// a name legitimately leaves the surface someday, delete it from this list
// in the same commit, with a reason.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const CORE_DIR_URL = new URL("../api/core/", import.meta.url);
const CONSTANTS_URL = new URL("../constants.mjs", import.meta.url);
// The one extension at the BOTTOM of the ladder: api/vendor/ holds the
// vendored Project Kitskey framework files (phase 1 of the approved
// migration), byte-pinned to the framework source by
// tests/vendor-parity.test.mjs. Framework code may not import app code, so
// this stays the lowest layer — vendored files import nothing but themselves.
const VENDOR_DIR_URL = new URL("../api/vendor/", import.meta.url);

// The layer rule as a pure function so its decisions are unit-testable:
// is this import target legal from a core file? Judged on the RESOLVED
// path — never on string prefixes, which "./" escapes via "./../".
function coreImportIsLegal(target, fileUrl) {
  let resolved;
  try {
    resolved = new URL(target, fileUrl);
  } catch {
    return false; // unparseable target: reject, never guess
  }
  if (resolved.href === CONSTANTS_URL.href) return true;
  if (resolved.href.startsWith(VENDOR_DIR_URL.href)) return true; // vendored Kitskey
  return resolved.href.startsWith(CORE_DIR_URL.href);
}

test("core import rule: sibling + constants leaf legal; escapes rejected on resolved paths", () => {
  const fileUrl = new URL("./http.mjs", CORE_DIR_URL);
  const cases = [
    ["./crypto.mjs", true], // sibling core file
    ["../../constants.mjs", true], // the root data leaf
    ["../vendor/http.mjs", true], // vendored Kitskey framework files (byte-pinned)
    ["../vendor/../shared.mjs", false], // "resolves inside core" alone is never enough
    ["./../shared.mjs", false], // "./" prefix escaping core — the bypass
    ["../shared.mjs", false], // shared.mjs is a topic-adjacent file, not core
    ["../posts.mjs", false], // topic modules are strictly above the ladder
    ["../../api/session.mjs", false], // same rule, verbose spelling
  ];
  for (const [target, expected] of cases) {
    assert.equal(coreImportIsLegal(target, fileUrl), expected, `import "${target}" from a core file`);
  }
});

test("core modules import nothing outside core/", () => {
  let files;
  try {
    files = readdirSync(CORE_DIR_URL);
  } catch {
    files = []; // fall through to the emptiness assert below
  }
  assert.ok(files.filter((f) => f.endsWith(".mjs")).length > 0, "api/core/ must exist for the guard to mean anything");
  for (const name of files.filter((f) => f.endsWith(".mjs"))) {
    const fileUrl = new URL(name, CORE_DIR_URL);
    const source = readFileSync(fileUrl, "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const target of imports) {
      assert.ok(
        coreImportIsLegal(target, fileUrl),
        `${name} imports "${target}" — core files may only import sibling core files, the vendored Kitskey files, or the root constants leaf`,
      );
    }
  }
});

test("the former shared.mjs export surface lives in the core modules", async () => {
  const homes = [
    await import("../api/core/auth.mjs"),
    await import("../api/core/crypto.mjs"),
    await import("../api/core/http.mjs"),
    await import("../api/core/images.mjs"),
    await import("../api/core/passwords.mjs"),
    await import("../api/core/roles.mjs"),
    await import("../api/core/shapers.mjs"),
    await import("../api/core/visibility.mjs"),
    await import("../api/core/archive.mjs"),
  ].map((m) => Object.keys(m));
  const union = new Set(homes.flat());
  for (const name of [
    "ROLE_OWNER_DB", "ROLE_ADMIN_DB", "ROLE_MEMBER_DB", "publicRole",
    "requestIpHash", "assertNetworkNotBanned", "POST_SELECT", "VIEW_INCREMENT_SQL",
    "isValidUsername", "isValidPassword", "createAvatarVersion", "blobToUint8Array",
    "sniffImageMime", "sanitizeImage", "imageResponse", "isValidPasswordPepper",
    "isValidSetupSecret", "hashPassword", "verifyPassword", "createSession",
    "rateLimit", "requireTurnstile", "isValidHexColor", "PROFILE_BANNER_COLORS",
    "PROFILE_ACCENTS", "normalizeProfileColorInput", "normalizeProfileColor",
    "normalizeProfileAccent", "normalizeBannerColor", "canViewPost",
    "archivePostRowsStatement",
    "HttpError", "nowSeconds", "sha256Hex", "randomToken", "equalConstantTime",
    "readSession", "requireCsrf", "requireUser", "requireSignedInRead", "requireStaff",
    "requireAdmin", "assertSameOrigin", "assertNotBanned", "requireMutationApplied",
    "readLimitedBody", "readJson", "requiredText", "securityHeaders", "json",
    "userByUsernameKey", "SOCIAL_PLATFORMS", "socialsFromRow", "publicUser",
    "publicPost", "postById", "MAX_JSON_BYTES",
  ]) {
    assert.ok(union.has(name), `the core modules must keep exporting ${name}`);
  }
});
