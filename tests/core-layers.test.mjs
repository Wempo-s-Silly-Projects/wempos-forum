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
  return resolved.href.startsWith(CORE_DIR_URL.href);
}

test("core import rule: sibling + constants leaf legal; escapes rejected on resolved paths", () => {
  const fileUrl = new URL("./http.mjs", CORE_DIR_URL);
  const cases = [
    ["./crypto.mjs", true], // sibling core file
    ["../../constants.mjs", true], // the root data leaf
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
        `${name} imports "${target}" — core files may only import sibling core files or the root constants leaf`,
      );
    }
  }
});

test("shared.mjs keeps its full export surface", async () => {
  const shared = await import("../api/shared.mjs");
  for (const name of [
    "ROLE_OWNER_DB", "ROLE_ADMIN_DB", "ROLE_MEMBER_DB", "publicRole",
    "requestIpHash", "assertNetworkNotBanned", "POST_SELECT", "VIEW_INCREMENT_SQL",
    "isValidUsername", "isValidPassword", "createAvatarVersion", "blobToUint8Array",
    "sniffImageMime", "sanitizeImage", "imageResponse", "isValidPasswordPepper",
    "isValidSetupSecret", "hashPassword", "verifyPassword", "createSession",
    "rateLimit", "requireTurnstile", "isValidHexColor", "PROFILE_BANNER_COLORS",
    "PROFILE_ACCENTS", "normalizeProfileColorInput", "normalizeProfileColor",
    "normalizeProfileAccent", "normalizeBannerColor", "canViewPost",
    // handleAvatarReadRoute left the surface in plan 3 Task 2 — moved
    // verbatim (with upload + the moderation queue) to api/avatars.mjs;
    // profiles.mjs imports from there now.
    "archivePostRowsStatement",
    // CUSTOM_CSS_MAX_BYTES + scopeProfileCss left the surface in plan 3
    // Task 1: the whole profile-CSS sandbox family moved verbatim to
    // api/profile-css.mjs (its only consumer, profiles.mjs, imports from
    // there now).
    "HttpError", "nowSeconds", "sha256Hex", "randomToken", "equalConstantTime",
    "readSession", "requireCsrf", "requireUser", "requireSignedInRead", "requiremod",
    "requireAdmin", "assertSameOrigin", "assertNotBanned", "requireMutationApplied",
    "readLimitedBody", "readJson", "requiredText", "securityHeaders", "json",
    "userByUsernameKey", "SOCIAL_PLATFORMS", "socialsFromRow", "publicUser",
    "publicPost", "postById", "MAX_JSON_BYTES",
  ]) {
    assert.ok(name in shared, `shared.mjs must keep exporting ${name}`);
  }
});
