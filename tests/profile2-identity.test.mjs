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

// Batch I items 2-6: profiles and identity on vendored FLOSS libraries.
//   2. colord + a11y: WCAG contrast warnings for member colours (both themes),
//      with a suggested fix; Coloris as the colour picker.
//   3. minidenticons: deterministic inline-SVG fallback avatars.
//   4. cropperjs: square crop before the avatar upload.
//   5. node-vibrant: optional header tint from a same-origin avatar.
//   6. a zero-image header pattern the member picks (stored, migration 0084).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as constants from "../constants.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedUser } from "./helpers/seed.mjs";
import { avatarSource, identiconDataUrl, identiconSvg } from "../public/js/profile-identity.js";
import {
  PROFILE_CONTRAST_MIN, THEME_SURFACES, accentContrastReport, bannerContrastReport, contrastRatio, suggestContrastFix,
} from "../public/js/profile-colours.js";
import { AVATAR_CROP_SIZE, cropOutputType, cropToBlob, shouldCropAvatar } from "../public/js/avatar-crop.js";
import { PROFILE_HEADER_STYLES, canTintHeader, headerClassFor, pickTint } from "../public/js/profile-header.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sha256 = (path) => createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex");

// ---------------------------------------------------------------- vendor pins

const VENDORED = {
  "public/js/vendor/colord.mjs": "524da27aa84b7ab93818d74f5a4f982549a4435b4de9842e251fff508efe9680",
  "public/js/vendor/colord-a11y.mjs": "9cddcbce4c7aa8f1900935429dcfa27b1210499eb4a4ba34c8bab1f014a71d50",
  "public/js/vendor/coloris.min.js": "3dd0ceac1a89ecf2840aee1fa4cb9667e49c19498ca17cc379d9deb359961bca",
  "public/js/vendor/coloris.min.css": "b5e003381340500620df07a09b982abbfe1a848f9ca7efc4f3b3d91f89b9d83d",
  "public/js/vendor/minidenticons.js": "3808f40f07c6a275b6437753739285eb8f58eba0a917d5873b0bf5a565a272e9",
  "public/js/vendor/cropper.esm.js": "e72099d275b7e4becb14eac76cc22f596f24292b7d3bbf54b8d7a53c9d7fcc73",
  "public/js/vendor/cropper.min.css": "23679f552ce73499f817de22b5dcdd9e1e5a1e50cd9d77e34bbd31bf65a85186",
  "public/js/vendor/vibrant.min.js": "6b0711da39e8e242395f4ccbf1ec74be2db3f8a324176e21516f1678f480f473",
};

test("each vendored profile library is the approved upstream build, byte for byte", () => {
  for (const [path, digest] of Object.entries(VENDORED)) assert.equal(sha256(path), digest, path);
});

test("REUSE.toml annotates every vendored profile library as MIT with its upstream holder", () => {
  const reuse = read("REUSE.toml");
  for (const path of Object.keys(VENDORED)) {
    const block = reuse.split("[[annotations]]").find((part) => part.includes('"' + path + '"'));
    assert.ok(block, "an annotations block names " + path);
    assert.match(block, /SPDX-License-Identifier = "MIT"/);
    assert.match(block, /precedence = "override"/);
  }
});

test("css-tree is a Worker dependency and the CSP is unchanged by this batch", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["css-tree"], "latest");
  const vendorHttp = read("api/vendor/http.mjs");
  assert.match(vendorHttp, /style-src 'self';/);
  assert.match(vendorHttp, /img-src 'self' data:;/);
});

// ---------------------------------------------------------------- identicons

test("identicons are deterministic inline SVG with no network reference", () => {
  const first = identiconSvg("wempo");
  assert.equal(identiconSvg("wempo"), first);
  assert.notEqual(identiconSvg("alice"), identiconSvg("bob"));
  assert.match(first, /^<svg [^>]*viewBox=/);
  assert.doesNotMatch(first.replace('xmlns="http://www.w3.org/2000/svg"', ""), /https?:|url\(/);
  const dataUrl = identiconDataUrl("wempo");
  assert.ok(dataUrl.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.equal(decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1)), first);
});

test("the avatar source keeps an uploaded avatar and falls back to the identicon", () => {
  assert.equal(avatarSource("/api/users/7/avatar", "wempo"), "/api/users/7/avatar");
  assert.equal(avatarSource("", "wempo"), identiconDataUrl("wempo"));
  assert.equal(avatarSource(null, "wempo"), identiconDataUrl("wempo"));
});

test("the profile heading and post cards paint the fallback instead of nothing", () => {
  assert.match(read("public/js/routes/profile.js"), /avatarSource\(profile\.avatarUrl, profile\.username\)/);
  assert.match(read("public/js/render.js"), /avatarSource\(post\.author\.avatarUrl, post\.author\.username\)/);
});

// ---------------------------------------------------------------- contrast

test("the contrast floor lives in constants.mjs and the client mirrors it", () => {
  assert.equal(constants.PROFILE_CONTRAST_MIN, 4.5);
  assert.equal(PROFILE_CONTRAST_MIN, constants.PROFILE_CONTRAST_MIN);
  assert.deepEqual(THEME_SURFACES, { light: "#fffaf0", dark: "#1d2836" });
  const styles = read("public/styles.css");
  assert.match(styles, /--paper: #fffaf0;/);
  assert.match(styles, /--paper: #1d2836;/);
});

test("contrast maths follows WCAG 2 relative luminance", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  // WCAG's exact value is 4.478...; colord truncates to two decimals, which
  // can only under-state a ratio (the safe direction for a floor check).
  assert.equal(contrastRatio("#777777", "#ffffff"), 4.47);
  assert.ok(contrastRatio("#777777", "#ffffff") < PROFILE_CONTRAST_MIN);
});

test("an accent is checked against both themes, with a fix that passes the failing one", () => {
  const yellow = accentContrastReport("#ffff00");
  assert.equal(yellow.light.ok, false);
  assert.equal(yellow.dark.ok, true);
  assert.equal(yellow.failing, "light");
  assert.ok(contrastRatio(yellow.suggestion, THEME_SURFACES.light) >= PROFILE_CONTRAST_MIN);
  const navy = accentContrastReport("#1a1a40");
  assert.equal(navy.light.ok, true);
  assert.equal(navy.dark.ok, false);
  assert.equal(navy.failing, "dark");
  assert.ok(contrastRatio(navy.suggestion, THEME_SURFACES.dark) >= PROFILE_CONTRAST_MIN);
  assert.equal(accentContrastReport("not a colour"), null);
  assert.equal(accentContrastReport(""), null);
});

test("a banner colour is checked against its white text", () => {
  const pale = bannerContrastReport("#f0f0f0");
  assert.equal(pale.ok, false);
  assert.ok(contrastRatio(pale.suggestion, "#ffffff") >= PROFILE_CONTRAST_MIN);
  assert.equal(bannerContrastReport("#2d6543").ok, true);
  assert.equal(bannerContrastReport("#2d6543").suggestion, null);
});

test("suggestContrastFix returns the colour itself when it already passes", () => {
  assert.equal(suggestContrastFix("#000000", "#ffffff"), "#000000");
});

// ---------------------------------------------------------------- crop

test("the crop canvas is a square of AVATAR_CROP_SIZE and the blob keeps a safe type", async () => {
  assert.equal(AVATAR_CROP_SIZE, constants.AVATAR_CROP_SIZE);
  assert.equal(AVATAR_CROP_SIZE, 512);
  const calls = [];
  const fakeCropper = {
    getCroppedCanvas(options) {
      calls.push(options);
      return {
        width: options.width,
        height: options.height,
        toBlob(done, type, quality) {
          done({ type, size: 1234, quality, width: options.width, height: options.height });
        },
      };
    },
  };
  const blob = await cropToBlob(fakeCropper, "image/jpeg");
  assert.equal(calls[0].width, 512);
  assert.equal(calls[0].height, 512);
  assert.equal(blob.width, 512);
  assert.equal(blob.height, 512);
  assert.equal(blob.type, "image/jpeg");
  assert.equal(cropOutputType("image/png"), "image/png");
  assert.equal(cropOutputType("image/webp"), "image/webp");
  assert.equal(cropOutputType("image/heic"), "image/jpeg");
});

test("cropToBlob rejects when the canvas cannot be produced", async () => {
  await assert.rejects(cropToBlob({ getCroppedCanvas: () => null }, "image/png"));
});

test("animated GIFs skip the cropper so their animation survives", () => {
  assert.equal(shouldCropAvatar({ type: "image/gif", size: 10 }), false);
  assert.equal(shouldCropAvatar({ type: "image/png", size: 10 }), true);
  assert.equal(shouldCropAvatar({ type: "image/png", size: 0 }), false);
  assert.equal(shouldCropAvatar(null), false);
});

// ---------------------------------------------------------------- header tint + pattern

test("header styles: the client list mirrors constants.mjs", () => {
  assert.deepEqual(PROFILE_HEADER_STYLES, constants.PROFILE_HEADER_STYLES);
  assert.deepEqual(constants.PROFILE_HEADER_STYLES, ["", "tint", "dots", "stripes", "grid"]);
  assert.equal(headerClassFor("dots"), "profile-header-dots");
  assert.equal(headerClassFor("tint"), "");
  assert.equal(headerClassFor("evil class"), "");
});

test("pickTint prefers the Vibrant swatch, then the muted ones", () => {
  const swatch = (hex) => ({ hex, getHex: () => hex });
  assert.equal(pickTint({ Vibrant: swatch("#aa3300"), Muted: swatch("#556677") }), "#aa3300");
  assert.equal(pickTint({ Vibrant: null, Muted: swatch("#556677") }), "#556677");
  assert.equal(pickTint({}), "");
  assert.equal(pickTint(null), "");
});

test("the tint runs only when chosen, never over a member colour, and only on same-origin images", () => {
  const origin = "https://wempos-forum.com";
  const base = { profileHeader: "tint", bannerColor: "", avatarUrl: "/api/users/1/avatar" };
  assert.equal(canTintHeader(base, origin), true);
  assert.equal(canTintHeader({ ...base, bannerColor: "#112233" }, origin), false);
  assert.equal(canTintHeader({ ...base, profileHeader: "dots" }, origin), false);
  assert.equal(canTintHeader({ ...base, avatarUrl: "https://evil.example/a.png" }, origin), false);
  assert.equal(canTintHeader({ ...base, avatarUrl: "" }, origin), false);
});

test("header patterns are zero-image, static CSS (nothing to animate under reduced motion)", () => {
  const styles = read("public/styles.css");
  for (const key of ["dots", "stripes", "grid"]) {
    const rule = styles.match(new RegExp("\\.profile-header-" + key + "\\s*\\{([^}]*)\\}"));
    assert.ok(rule, "a rule for " + key);
    assert.doesNotMatch(rule[1], /url\(|animation/);
  }
});

// ---------------------------------------------------------------- server: header style

const MIGRATION = "migrations/0084_profile_header_styles.sql";

test("migration 0084 is CREATE-only with a users FK that cascades", () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS profile_header_styles/);
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  const env = makeEnv();
  const fks = env.__sqlite.prepare("PRAGMA foreign_key_list(profile_header_styles)").all();
  assert.equal(fks[0].table, "users");
  assert.equal(fks[0].on_delete, "CASCADE");
});

test("PUT /api/me/profile-header stores a listed style, clears on empty, refuses others", async () => {
  const env = makeEnv();
  const id = await seedUser(env.__sqlite, { username: "alice" });
  const session = forgeSession(env.__sqlite, id);
  const put = (style) => call(env, "/api/me/profile-header", { method: "PUT", body: { style }, session });
  const ok = await put("dots");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { style: "dots" });
  const profile = await (await call(env, "/api/users/alice")).json();
  assert.equal(profile.profileHeader, "dots");
  assert.equal((await put("<script>")).status, 400);
  assert.equal((await put(42)).status, 400);
  assert.equal((await put("")).status, 200);
  const row = env.__sqlite.prepare("SELECT * FROM profile_header_styles WHERE user_id = ?").get(id);
  assert.equal(row, undefined);
  assert.equal((await (await call(env, "/api/users/alice")).json()).profileHeader, "");
});

test("PUT /api/me/profile-header needs a signed-in member", async () => {
  const env = makeEnv();
  const response = await call(env, "/api/me/profile-header", { method: "PUT", body: { style: "dots" } });
  assert.ok([401, 403].includes(response.status));
});
