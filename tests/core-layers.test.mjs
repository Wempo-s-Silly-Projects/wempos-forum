// v4.0 layer guard (plan 1): two structural pins that every core-split move
// must keep true. (1) api/core/ is the bottom of the import ladder — its
// files may import only each other, never a topic module or shared.mjs, or
// the layering is broken and cycles become possible. (2) api/shared.mjs's
// export surface is a compatibility contract: worker.mjs re-exports through
// it and every api module + test imports it, so a name may MOVE into core
// but may never VANISH. The list below is the complete surface as of the
// v4.0 branch point (2dd922f) — if a name legitimately leaves the surface
// someday, delete it from this list in the same commit, with a reason.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

test("core modules import nothing outside core/", () => {
  const dir = new URL("../api/core/", import.meta.url);
  let files = [];
  try { files = readdirSync(dir); } catch { return; } // no core/ yet — populated by the move tasks
  for (const name of files.filter((f) => f.endsWith(".mjs"))) {
    const source = readFileSync(new URL(name, dir), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const target of imports) {
      // constants.mjs (repo root) is a pure data leaf beneath core in the
      // ladder — importing it can never cycle. Everything else must be a
      // sibling core file.
      assert.ok(
        target.startsWith("./") || target === "../../constants.mjs",
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
    "archivePostRowsStatement", "CUSTOM_CSS_MAX_BYTES", "scopeProfileCss",
    "HttpError", "nowSeconds", "sha256Hex", "randomToken", "equalConstantTime",
    "readSession", "requireCsrf", "requireUser", "requireSignedInRead", "requiremod",
    "requireAdmin", "assertSameOrigin", "assertNotBanned", "requireMutationApplied",
    "readLimitedBody", "readJson", "requiredText", "securityHeaders", "json",
    "userByUsernameKey", "SOCIAL_PLATFORMS", "socialsFromRow", "publicUser",
    "publicPost", "postById", "handleAvatarReadRoute", "MAX_JSON_BYTES",
  ]) {
    assert.ok(name in shared, `shared.mjs must keep exporting ${name}`);
  }
});
