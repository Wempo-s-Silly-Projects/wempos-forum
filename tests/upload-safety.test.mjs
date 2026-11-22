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

// Upload safety + speed pipeline. Client: magic-byte type check before any
// upload, metadata strip + downscale through the vendored
// browser-image-compression (never for GIFs or animated PNG/WebP, which stay
// byte-identical). Worker: authoritative file-type agreement on every image
// intake, width/height read with image-dimensions and stored by content hash
// (migration 0080, CREATE-only) so <img> tags carry width/height. SVG is
// refused on both sides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import * as constants from "../constants.mjs";
import { imageDimensions, inspectImageUpload, sanitizeImage } from "../api/core/images.mjs";
import { attachmentRowsForView, insertAttachments, readComposedBody } from "../api/attachments.mjs";
import {
  UPLOAD_MAX_LONG_SIDE, UPLOAD_TARGET_MAX_MB, isAnimatedImage, prepareImageUpload, prepareImageUploads,
  sniffUploadType,
} from "../public/js/upload-prep.js";
import { makeEnv } from "./helpers/d1.mjs";
import { seedPost, seedUser } from "./helpers/seed.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const VENDOR_PATH = "public/js/vendor/browser-image-compression.mjs";
const VENDOR_SHA256 = "fdb2db089dcd553972e417c3f0735a2e3ae2abaad64cd196bb28477755e692d9";

// ---------------------------------------------------------------- fixtures

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

const pngChunk = (type, data) => concat(u32be(data.length), ascii(type), data, new Uint8Array(4));
const png = (width, height, { animated = false } = {}) => concat(
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", concat(u32be(width), u32be(height), Uint8Array.from([8, 6, 0, 0, 0]))),
  ...(animated ? [pngChunk("acTL", concat(u32be(2), u32be(0)))] : []),
  pngChunk("IDAT", Uint8Array.from([0])),
  pngChunk("IEND", new Uint8Array(0)),
);
const jpegSegment = (marker, data) => concat(Uint8Array.from([0xff, marker]), u16be(data.length + 2), data);
const GPS_APP1 = jpegSegment(0xe1, concat(ascii("Exif\0\0MM\0*"), ascii("GPSLatitude 51.5007N GPSLongitude 0.1246W")));
const jpeg = (width, height, { exif = false } = {}) => concat(
  Uint8Array.from([0xff, 0xd8]),
  ...(exif ? [GPS_APP1] : []),
  jpegSegment(0xc0, concat(Uint8Array.from([8]), u16be(height), u16be(width), Uint8Array.from([1, 1, 0x11, 0]))),
  jpegSegment(0xda, Uint8Array.from([1, 1, 0, 0, 0x3f, 0])),
  Uint8Array.from([0x12, 0x34, 0xff, 0x00, 0x56]),
  Uint8Array.from([0xff, 0xd9]),
);
const gif = (width, height) => concat(
  ascii("GIF89a"), u16le(width), u16le(height), Uint8Array.from([0, 0, 0]),
  Uint8Array.from([0x2c]), u16le(0), u16le(0), u16le(width), u16le(height), Uint8Array.from([0]),
  Uint8Array.from([2, 2, 0x4c, 0x01, 0]),
  Uint8Array.from([0x3b]),
);
const webp = (width, height, { animated = false } = {}) => {
  const vp8x = concat(ascii("VP8X"), u32le(10), Uint8Array.from([animated ? 0x02 : 0, 0, 0, 0]),
    u24le(width - 1), u24le(height - 1));
  return concat(ascii("RIFF"), u32le(4 + vp8x.length), ascii("WEBP"), vp8x);
};
const EXE = concat(ascii("MZ"), new Uint8Array(30).fill(0x90), ascii("This program cannot be run in DOS mode"));
const HTML = ascii("<!doctype html><html><script>alert(1)</script></html>");
const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>');
const PDF = ascii("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF");
const hasBytes = (haystack, needle) => Buffer.from(haystack).includes(Buffer.from(needle));
const file = (bytes, name, type) => new File([bytes], name, { type });

// ---------------------------------------------------------------- Worker

test("worker: inspectImageUpload accepts only real JPEG/PNG/WebP/GIF bytes", async () => {
  const accepted = [
    [png(3, 2), "image/png"], [jpeg(4, 5), "image/jpeg"], [gif(6, 7), "image/gif"], [webp(8, 9), "image/webp"],
    [png(3, 2, { animated: true }), "image/png"],
  ];
  for (const [bytes, mime] of accepted) {
    const result = await inspectImageUpload(bytes);
    assert.ok(result, mime);
    assert.equal(result.mime, mime);
  }
  for (const [label, bytes] of [["exe", EXE], ["html", HTML], ["svg", SVG], ["pdf", PDF], ["empty", new Uint8Array(0)]]) {
    assert.equal(await inspectImageUpload(bytes), null, label);
  }
});

test("worker: inspectImageUpload strips GPS EXIF and reports dimensions", async () => {
  const result = await inspectImageUpload(jpeg(40, 30, { exif: true }));
  assert.ok(result);
  assert.equal(hasBytes(result.bytes, ascii("GPSLatitude")), false);
  assert.equal(hasBytes(result.bytes, ascii("Exif")), false);
  assert.deepEqual([result.width, result.height], [40, 30]);
  assert.equal(sanitizeImage(jpeg(1, 1, { exif: true })).bytes.length, jpeg(1, 1).length);
});

test("worker: imageDimensions reads width/height for PNG, JPEG, GIF and WebP headers", () => {
  assert.deepEqual(imageDimensions(png(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(jpeg(1024, 768)), { width: 1024, height: 768 });
  assert.deepEqual(imageDimensions(gif(320, 200)), { width: 320, height: 200 });
  assert.deepEqual(imageDimensions(webp(1920, 1080)), { width: 1920, height: 1080 });
  assert.equal(imageDimensions(EXE), null);
  assert.equal(imageDimensions(SVG), null);
});

const composed = (name, bytes, type) => {
  const form = new FormData();
  form.append("body", "hello");
  form.append("images", file(bytes, name, type));
  return new Request("https://wempos-forum.com/api/posts", { method: "POST", body: form });
};

test("worker: a renamed .exe, .html or .svg posing as a PNG is refused at intake", async () => {
  for (const [label, bytes] of [["exe", EXE], ["html", HTML], ["svg", SVG]]) {
    await assert.rejects(readComposedBody(composed("photo.png", bytes, "image/png"), makeEnv()),
      (error) => error.status === 400, label);
  }
  await assert.rejects(readComposedBody(composed("vector.svg", SVG, "image/svg+xml"), makeEnv()),
    (error) => error.status === 400);
});

test("worker: every image intake route runs the authoritative inspection", () => {
  for (const path of ["api/attachments.mjs", "api/gifs.mjs", "api/avatars.mjs", "api/dm-images.mjs"]) {
    assert.match(read(path), /await inspectImageUpload\(/, path);
  }
});

test("migration 0080 is CREATE-only and stores dimensions by content hash", () => {
  const name = readdirSync(new URL("migrations/", ROOT)).find((entry) => entry.startsWith("0080_"));
  assert.ok(name, "migrations/0080_*.sql exists");
  const sql = read("migrations/" + name).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS image_dimensions/);
  assert.doesNotMatch(sql, /\b(ALTER|DROP|DELETE|UPDATE|INSERT)\b/i);
});

test("worker: attachments carry width/height from intake through the post payload", async () => {
  const env = makeEnv();
  const userId = await seedUser(env.__sqlite, { username: "ann", role: "admin" });
  const postId = seedPost(env.__sqlite, { authorId: userId, body: "hi" });
  const { files } = await readComposedBody(composed("a.png", png(12, 34), "image/png"), env);
  assert.deepEqual([files[0].width, files[0].height], [12, 34]);
  await insertAttachments(env.FORUM_DB, postId, userId, files);
  const rows = await attachmentRowsForView(env.FORUM_DB, [postId], { id: userId, role: "admin" });
  const [row] = rows.get(postId);
  assert.deepEqual([row.width, row.height], [12, 34]);
});

test("client render: attachment images get width/height when the payload has them", () => {
  const render = read("public/js/render.js");
  assert.match(render, /image\.width = attachment\.width/);
  assert.match(render, /image\.height = attachment\.height/);
});

// ---------------------------------------------------------------- client

test("client: sniffUploadType matrix (bytes decide, never the name or claimed type)", () => {
  assert.equal(sniffUploadType(png(1, 1)), "image/png");
  assert.equal(sniffUploadType(jpeg(1, 1)), "image/jpeg");
  assert.equal(sniffUploadType(gif(1, 1)), "image/gif");
  assert.equal(sniffUploadType(webp(1, 1)), "image/webp");
  for (const bytes of [EXE, HTML, SVG, PDF, new Uint8Array(0)]) assert.equal(sniffUploadType(bytes), null);
});

test("client: animated PNG/WebP are detected so they skip the canvas", () => {
  assert.equal(isAnimatedImage(png(2, 2, { animated: true }), "image/png"), true);
  assert.equal(isAnimatedImage(png(2, 2), "image/png"), false);
  assert.equal(isAnimatedImage(webp(2, 2, { animated: true }), "image/webp"), true);
  assert.equal(isAnimatedImage(webp(2, 2), "image/webp"), false);
});

const neverCompress = () => { throw new Error("compressor must not run"); };

test("client: a GIF passes through byte-identical (same File, no re-encode)", async () => {
  const original = file(gif(5, 5), "party.gif", "image/gif");
  assert.equal(await prepareImageUpload(original, { compress: neverCompress }), original);
  const animated = file(png(5, 5, { animated: true }), "anim.png", "image/png");
  assert.equal(await prepareImageUpload(animated, { compress: neverCompress }), animated);
});

test("client: a renamed .exe/.html/.svg is refused before upload", async () => {
  for (const bytes of [EXE, HTML, SVG]) {
    await assert.rejects(prepareImageUpload(file(bytes, "photo.png", "image/png"), { compress: neverCompress }),
      /photo\.png/);
  }
  await assert.rejects(
    prepareImageUpload(file(gif(1, 1), "a.gif", "image/gif"), { compress: neverCompress, accept: ["image/png"] }),
    /a\.gif/,
  );
});

test("client: JPEG with GPS EXIF goes out as the canvas re-encode, metadata never preserved", async () => {
  const calls = [];
  const clean = jpeg(40, 30);
  const compress = async (input, options) => {
    calls.push(options);
    return new File([clean], "blob", { type: "image/jpeg" });
  };
  const original = file(jpeg(40, 30, { exif: true }), "trip.jpg", "image/jpeg");
  const prepared = await prepareImageUpload(original, { compress });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].preserveExif, false);
  assert.equal(calls[0].useWebWorker, false, "the web-worker mode fetches the library from a CDN");
  assert.equal(prepared.name, "trip.jpg");
  assert.equal(prepared.type, "image/jpeg");
  const bytes = new Uint8Array(await prepared.arrayBuffer());
  assert.equal(hasBytes(bytes, ascii("GPSLatitude")), false);
});

test("client: oversized photos are capped on the longest side and never upscaled", async () => {
  // A stand-in for the library's canvas resize honouring maxWidthOrHeight.
  const compress = async (input, options) => {
    const source = imageDimensions(new Uint8Array(await input.arrayBuffer()));
    const scale = Math.min(1, options.maxWidthOrHeight / Math.max(source.width, source.height));
    return new File([png(Math.round(source.width * scale), Math.round(source.height * scale))], "x",
      { type: "image/png" });
  };
  const big = await prepareImageUpload(file(png(8000, 4000), "big.png", "image/png"), { compress });
  const bigSize = imageDimensions(new Uint8Array(await big.arrayBuffer()));
  assert.equal(Math.max(bigSize.width, bigSize.height), UPLOAD_MAX_LONG_SIDE);
  assert.ok(bigSize.width < 8000);
  const small = await prepareImageUpload(file(png(300, 200), "small.png", "image/png"), { compress });
  assert.deepEqual(imageDimensions(new Uint8Array(await small.arrayBuffer())), { width: 300, height: 200 });
});

test("client: a compressor failure falls back to the original (the Worker still strips metadata)", async () => {
  const original = file(jpeg(2, 2), "a.jpg", "image/jpeg");
  const prepared = await prepareImageUpload(original, { compress: async () => { throw new Error("no canvas"); } });
  assert.equal(prepared, original);
});

test("client: prepareImageUploads keeps order and refuses the batch on one bad file", async () => {
  const keep = async (input) => input;
  const files = [file(gif(1, 1), "1.gif", "image/gif"), file(png(1, 1), "2.png", "image/png")];
  const prepared = await prepareImageUploads(files, { compress: keep });
  assert.deepEqual(prepared.map((entry) => entry.name), ["1.gif", "2.png"]);
  await assert.rejects(prepareImageUploads([...files, file(EXE, "3.png", "image/png")], { compress: keep }), /3\.png/);
});

test("caps live in root constants.mjs and the client mirrors them", () => {
  assert.equal(constants.UPLOAD_MAX_LONG_SIDE, 2560);
  assert.equal(constants.UPLOAD_TARGET_MAX_MB, 2);
  assert.equal(UPLOAD_MAX_LONG_SIDE, constants.UPLOAD_MAX_LONG_SIDE);
  assert.equal(UPLOAD_TARGET_MAX_MB, constants.UPLOAD_TARGET_MAX_MB);
});

test("every upload path prepares files before sending", () => {
  assert.match(read("public/js/routes/composer.js"), /await prepareImageUploads\(/);
  assert.match(read("public/js/dm-extras.js"), /await prepareImageUpload\(/);
  assert.match(read("public/js/routes/profile.js"), /prepareImageUpload\(/);
});

// ---------------------------------------------------------------- vendoring

test("browser-image-compression 2.0.2 is vendored byte for byte, MIT in REUSE.toml", () => {
  const bytes = readFileSync(new URL(VENDOR_PATH, ROOT));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), VENDOR_SHA256);
  const reuse = read("REUSE.toml");
  const block = reuse.split("[[annotations]]").find((part) => part.includes(`"${VENDOR_PATH}"`));
  assert.ok(block, "REUSE.toml annotates the vendored file");
  assert.match(block, /SPDX-License-Identifier = "MIT"/);
  assert.match(block, /Donald Chan/);
  assert.match(block, /precedence = "override"/);
});

test("the client loads the compressor lazily from the same origin (no CDN, no worker)", () => {
  const prep = read("public/js/upload-prep.js");
  assert.match(prep, /import\("\.\/vendor\/browser-image-compression\.mjs"\)/);
  assert.doesNotMatch(prep, /https?:\/\/(?!www\.gnu\.org)/);
});

test("worker libraries are AGPL-compatible dependencies pinned to latest", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["file-type"], "latest");
  assert.equal(pkg.dependencies["image-dimensions"], "latest");
});
