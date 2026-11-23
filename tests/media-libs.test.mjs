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

// Media libraries lane (L1): is-animated decides which uploads skip the
// canvas, exifr refuses a photo that would still leave the browser with GPS
// coordinates, and screenfull gives the image viewer a full-screen toggle.
// Each library is vendored verbatim and imported lazily, same-origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { t } from "../public/js/i18n.js";
import { carriesLocation, isAnimatedImage, prepareImageUpload } from "../public/js/upload-prep.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sha256 = (path) => createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex");

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const ascii = (text) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
const u32be = (n) => Uint8Array.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16be = (n) => Uint8Array.from([n >>> 8, n & 255]);
const u16le = (n) => Uint8Array.from([n & 255, n >>> 8]);
const u24le = (n) => Uint8Array.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);
const u32le = (n) => Uint8Array.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]);
const file = (bytes, name, type) => new File([bytes], name, { type });

const pngChunk = (type, data) => concat(u32be(data.length), ascii(type), data, new Uint8Array(4));
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (width, height) => pngChunk("IHDR", concat(u32be(width), u32be(height), Uint8Array.from([8, 6, 0, 0, 0])));
const png = (width, height) => concat(PNG_SIGNATURE, ihdr(width, height),
  pngChunk("IDAT", Uint8Array.from([0])), pngChunk("IEND", new Uint8Array(0)));
// A real APNG shape: acTL, then fcTL + IDAT (frame 1), then fcTL + fdAT
// (frame 2). `padding` grows the first frame so the second frame sits far
// past any small header read.
const apng = (width, height, { padding = 0 } = {}) => concat(PNG_SIGNATURE, ihdr(width, height),
  pngChunk("acTL", concat(u32be(2), u32be(0))),
  pngChunk("fcTL", new Uint8Array(26)),
  pngChunk("IDAT", new Uint8Array(1 + padding)),
  pngChunk("fcTL", new Uint8Array(26)),
  pngChunk("fdAT", new Uint8Array(5)),
  pngChunk("IEND", new Uint8Array(0)));
// acTL alone, with no second frame: not an animation.
const fakeApng = (width, height) => concat(PNG_SIGNATURE, ihdr(width, height),
  pngChunk("acTL", concat(u32be(1), u32be(0))), pngChunk("IDAT", Uint8Array.from([0])), pngChunk("IEND", new Uint8Array(0)));
const webp = (width, height, { animated = false } = {}) => {
  const vp8x = concat(ascii("VP8X"), u32le(10), Uint8Array.from([animated ? 0x02 : 0, 0, 0, 0]),
    u24le(width - 1), u24le(height - 1));
  return concat(ascii("RIFF"), u32le(4 + vp8x.length), ascii("WEBP"), vp8x);
};
const gif = (width, height) => concat(
  ascii("GIF89a"), u16le(width), u16le(height), Uint8Array.from([0, 0, 0]),
  Uint8Array.from([0x2c]), u16le(0), u16le(0), u16le(width), u16le(height), Uint8Array.from([0]),
  Uint8Array.from([2, 2, 0x4c, 0x01, 0]),
  Uint8Array.from([0x3b]),
);
// Counts compressor calls: a throwing stub would be swallowed by the
// fallback-to-original path and prove nothing.
const countingCompress = () => {
  const calls = [];
  const compress = async (input) => { calls.push(input); return new File([png(1, 1)], "x", { type: "image/png" }); };
  return { calls, compress };
};
const reuseBlock = (path) => read("REUSE.toml").split("[[annotations]]").find((part) => part.includes(`"${path}"`));

// ------------------------------------------------------------ is-animated

test("is-animated: real APNG and animated WebP skip the canvas; still ones do not", async () => {
  assert.equal(await isAnimatedImage(apng(4, 4), "image/png"), true);
  assert.equal(await isAnimatedImage(png(4, 4), "image/png"), false);
  assert.equal(await isAnimatedImage(fakeApng(4, 4), "image/png"), false, "acTL without a second frame is still");
  assert.equal(await isAnimatedImage(webp(4, 4, { animated: true }), "image/webp"), true);
  assert.equal(await isAnimatedImage(webp(4, 4), "image/webp"), false);
});

test("is-animated: every GIF stays byte-identical (a canvas cannot write GIF)", async () => {
  assert.equal(await isAnimatedImage(gif(2, 2), "image/gif"), true);
  const original = file(gif(2, 2), "one-frame.gif", "image/gif");
  const { calls, compress } = countingCompress();
  assert.equal(await prepareImageUpload(original, { compress }), original);
  assert.equal(calls.length, 0);
});

test("is-animated: an APNG whose second frame lies past 64 KiB is still sent untouched", async () => {
  const original = file(apng(8, 8, { padding: 80 * 1024 }), "long.png", "image/png");
  const { calls, compress } = countingCompress();
  assert.equal(await prepareImageUpload(original, { compress }), original);
  assert.equal(calls.length, 0, "the canvas would flatten it");
});

test("is-animated: a still PNG goes through the compressor", async () => {
  const { calls, compress } = countingCompress();
  await prepareImageUpload(file(png(4, 4), "still.png", "image/png"), { compress });
  assert.equal(calls.length, 1);
});

test("is-animated: the in-house chunk walker is gone and the library loads lazily", () => {
  const prep = read("public/js/upload-prep.js");
  assert.doesNotMatch(prep, /acTL|VP8X/, "no hand-rolled animation sniffing left");
  assert.match(prep, /import\("\.\/vendor\/is-animated\/index\.mjs"\)/);
  assert.doesNotMatch(prep, /^import .*is-animated/m, "never a static import");
});

test("is-animated 3.0.22 is vendored verbatim (src/), MIT in REUSE.toml", () => {
  const pins = {
    "public/js/vendor/is-animated/index.mjs": "ce63cde62e37085d119d28975f0a6629cfc8e18839501e995459aba61aa49b44",
    "public/js/vendor/is-animated/utils/gif.mjs": "1d1c642d5d34740e18d0ed70ed1b9fe593c3cc8689b006e2cb2b5c83957d6d7f",
    "public/js/vendor/is-animated/utils/png.mjs": "74b295b7752ee7cb939ca1fdc4fab0cee0d60a9c2d607d2a53063ad77b783f64",
    "public/js/vendor/is-animated/utils/webp.mjs": "da9d82302851256d425ceb75ece73376c7820ddfcb9fc8d686ecc41b04daa8bf",
    "public/js/vendor/is-animated/utils/avif.mjs": "665bff2fff2ddb7ae7a23c8a9f4418f264bcf502484b2fbb8d4db6a17d6c5eca",
  };
  for (const [path, digest] of Object.entries(pins)) assert.equal(sha256(path), digest, path);
  const block = reuseBlock("public/js/vendor/is-animated/**");
  assert.ok(block, "REUSE.toml annotates is-animated");
  assert.equal(block.match(/SPDX-License-Identifier/g).length, 1);
  assert.match(block, /SPDX-License-Identifier = "MIT"/);
  assert.match(block, /precedence = "override"/);
});

// ------------------------------------------------------------ exifr

// A real big-endian TIFF/EXIF block: IFD0 points at a GPS IFD holding
// latitude 51 deg 30' N and longitude 0 deg 7' W as rationals.
const ifdEntry = (tag, type, count, value) => concat(u16be(tag), u16be(type), u32be(count), value);
const rational = (numerator, denominator) => concat(u32be(numerator), u32be(denominator));
const GPS_IFD_AT = 26;
const GPS_DATA_AT = GPS_IFD_AT + 2 + 4 * 12 + 4;
const tiffWithGps = () => concat(
  ascii("MM"), u16be(42), u32be(8),
  u16be(1), ifdEntry(0x8825, 4, 1, u32be(GPS_IFD_AT)), u32be(0),
  u16be(4),
  ifdEntry(0x0001, 2, 2, ascii("N\0\0\0")),
  ifdEntry(0x0002, 5, 3, u32be(GPS_DATA_AT)),
  ifdEntry(0x0003, 2, 2, ascii("W\0\0\0")),
  ifdEntry(0x0004, 5, 3, u32be(GPS_DATA_AT + 24)),
  u32be(0),
  rational(51, 1), rational(30, 1), rational(0, 1),
  rational(0, 1), rational(7, 1), rational(0, 1),
);
const jpegSegment = (marker, data) => concat(Uint8Array.from([0xff, marker]), u16be(data.length + 2), data);
const jpeg = ({ gps = false } = {}) => concat(
  Uint8Array.from([0xff, 0xd8]),
  ...(gps ? [jpegSegment(0xe1, concat(ascii("Exif\0\0"), tiffWithGps()))] : []),
  jpegSegment(0xc0, concat(Uint8Array.from([8]), u16be(2), u16be(2), Uint8Array.from([1, 1, 0x11, 0]))),
  jpegSegment(0xda, Uint8Array.from([1, 1, 0, 0, 0x3f, 0])),
  Uint8Array.from([0x12, 0x34, 0xff, 0xd9]),
);
const noCanvas = async () => { throw new Error("no canvas"); };
const locationKept = (name) => (error) => error.message === t("attachments.locationKept", { name });

test("exifr: the vendored parser finds GPS coordinates in a real EXIF block", async () => {
  assert.equal(await carriesLocation(jpeg({ gps: true })), true);
  assert.equal(await carriesLocation(jpeg()), false);
  assert.equal(await carriesLocation(png(2, 2)), false, "an unsupported format is not a location");
});

test("exifr: a photo the canvas could not re-encode is refused while it still holds GPS", async () => {
  await assert.rejects(prepareImageUpload(file(jpeg({ gps: true }), "trip.jpg", "image/jpeg"), { compress: noCanvas }),
    locationKept("trip.jpg"));
  const unusable = async () => new File([ascii("not an image at all")], "x", { type: "image/jpeg" });
  await assert.rejects(prepareImageUpload(file(jpeg({ gps: true }), "b.jpg", "image/jpeg"), { compress: unusable }),
    locationKept("b.jpg"));
});

test("exifr: a photo without GPS still falls back to the original", async () => {
  const original = file(jpeg(), "plain.jpg", "image/jpeg");
  assert.equal(await prepareImageUpload(original, { compress: noCanvas }), original);
});

test("exifr: a successful re-encode never loads the parser", async () => {
  let located = 0;
  const locate = async () => { located += 1; return { latitude: 1, longitude: 2 }; };
  const compress = async () => new File([jpeg()], "x", { type: "image/jpeg" });
  const prepared = await prepareImageUpload(file(jpeg({ gps: true }), "c.jpg", "image/jpeg"), { compress, locate });
  assert.equal(prepared.name, "c.jpg");
  assert.equal(located, 0);
});

test("exifr: lite build vendored verbatim, imported lazily, MIT in REUSE.toml", () => {
  assert.equal(sha256("public/js/vendor/exifr/lite.esm.mjs"),
    "9c18a09ddc50bb7f4171fa292e5593d6bf4b96857783b6e8e20cc6c0a53c73c1");
  const prep = read("public/js/upload-prep.js");
  assert.match(prep, /import\("\.\/vendor\/exifr\/lite\.esm\.mjs"\)/);
  const block = reuseBlock("public/js/vendor/exifr/**");
  assert.ok(block, "REUSE.toml annotates exifr");
  assert.equal(block.match(/SPDX-License-Identifier/g).length, 1);
  assert.match(block, /SPDX-License-Identifier = "MIT"/);
});
