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

import { t } from "./i18n.js";

// Upload safety + speed, client half. Before an image leaves the browser:
// 1. its first bytes must be a JPEG, PNG, WebP or GIF signature — a renamed
//    .exe/.html/.svg is refused here with the composer's own wrong-type
//    notice (the Worker re-checks everything; this spares a doomed upload);
// 2. a still photo is re-encoded through a canvas by the vendored
//    browser-image-compression, which drops EXIF/GPS metadata and shrinks the
//    longest side to UPLOAD_MAX_LONG_SIDE (never upscaling);
// 3. GIFs and animated PNG/WebP are sent byte-identical — a canvas would
//    flatten the animation (is-animated decides, see below).
// The compressor runs on the main thread (useWebWorker: false): its worker
// mode loads the library from a CDN, which would be a third-party request.
// It is imported lazily, same-origin, only when a photo is actually sent.

// Mirrors constants.mjs (pinned equal by tests/upload-safety.test.mjs).
export const UPLOAD_MAX_LONG_SIDE = 2560;
export const UPLOAD_TARGET_MAX_MB = 2;
export const UPLOAD_AVATAR_TARGET_MAX_MB = 1;

export const UPLOAD_IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// The type sniff reads only the first bytes.
const HEADER_BYTES = 64 * 1024;
const MIN_SNIFF_BYTES = 12;
const JPEG_QUALITY = 0.85;
const MAX_COMPRESS_ITERATIONS = 4;

const matches = (bytes, offset, signature) =>
  signature.every((value, index) => bytes[offset + index] === value);
const ascii = (bytes, offset, length) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

// Same signatures as the Worker's sniffImageMime (api/core/images.mjs).
export function sniffUploadType(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < MIN_SNIFF_BYTES) return null;
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 4) === "GIF8" && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "image/gif";
  }
  return null;
}

// Animation is decided by the vendored is-animated (imported lazily, only
// when a PNG or WebP is actually sent). It reads the WHOLE file, so an APNG
// whose second frame lies past any header window is still found. Every GIF
// counts as animated: a canvas cannot write GIF, so a GIF is never re-encoded.
// The library takes an ArrayBuffer (a Uint8Array would hit its Node Buffer
// branch), so the bytes are copied into one of their own.
const loadIsAnimated = async (buffer) => {
  const { default: isAnimated } = await import("./vendor/is-animated/index.mjs");
  return isAnimated(buffer);
};

export async function isAnimatedImage(bytes, mime, detect = loadIsAnimated) {
  if (mime === "image/gif") return true;
  if (mime !== "image/png" && mime !== "image/webp") return false;
  return Boolean(await detect(bytes.slice().buffer));
}

const readHeader = async (blob) => new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());

const loadCompressor = async (file, options) => {
  const { default: imageCompression } = await import("./vendor/browser-image-compression.mjs");
  return imageCompression(file, options);
};

const wrongTypeMessage = (name) => t("attachments.wrongType", { name });
const locationKeptMessage = (name) => t("attachments.locationKept", { name });

// GPS guard (exifr, lite build: JPEG/HEIC EXIF). The canvas re-encode above
// is what strips EXIF; when it cannot run, a JPEG would leave the browser
// with its metadata intact. Before that original is sent, the vendored exifr
// (imported lazily, only on this fallback path) looks for GPS coordinates,
// and a photo that still holds them is refused rather than uploaded: the
// location never leaves the device. A parse failure (no EXIF, a format the
// lite build does not read) is "no location found"; the Worker still strips
// every metadata segment it receives.
const loadLocator = async (buffer) => {
  const { gps } = await import("./vendor/exifr/lite.esm.mjs");
  return gps(buffer);
};

export async function carriesLocation(bytes, locate = loadLocator) {
  try {
    const found = await locate(bytes.slice().buffer);
    return Number.isFinite(found?.latitude) && Number.isFinite(found?.longitude);
  } catch {
    return false;
  }
}

// Returns the File to upload: the original (GIF, animated, or when the canvas
// path fails or yields something unusable) or the re-encoded, metadata-free
// copy under the original name. Throws an Error carrying a translated
// wrong-type message when the bytes are not an accepted image, or a
// location-kept message when an un-re-encoded JPEG still holds GPS data.
export async function prepareImageUpload(file, options = {}) {
  const {
    compress = loadCompressor,
    accept = UPLOAD_IMAGE_TYPES,
    maxSizeMB = UPLOAD_TARGET_MAX_MB,
    wrongType = wrongTypeMessage,
    detectAnimation = loadIsAnimated,
    locate = loadLocator,
  } = options;
  const header = await readHeader(file);
  const mime = sniffUploadType(header);
  if (!mime || !accept.includes(mime)) throw new Error(wrongType(file.name));
  const sendOriginal = async () => {
    if (mime === "image/jpeg" && await carriesLocation(new Uint8Array(await file.arrayBuffer()), locate)) {
      throw new Error(locationKeptMessage(file.name));
    }
    return file;
  };
  if (await isAnimatedImage(new Uint8Array(await file.arrayBuffer()), mime, detectAnimation)) return file;
  let output;
  try {
    output = await compress(file, {
      maxWidthOrHeight: UPLOAD_MAX_LONG_SIDE,
      maxSizeMB,
      useWebWorker: false,
      preserveExif: false,
      initialQuality: JPEG_QUALITY,
      maxIteration: MAX_COMPRESS_ITERATIONS,
      fileType: mime,
    });
  } catch {
    // No canvas, an undecodable image, or a browser quirk: send the original
    // (unless it still holds GPS). The Worker strips its metadata and refuses
    // it if it is not an image.
    return sendOriginal();
  }
  if (!(output instanceof Blob)) return sendOriginal();
  const outputMime = sniffUploadType(await readHeader(output));
  if (!outputMime || !accept.includes(outputMime)) return sendOriginal();
  return new File([output], file.name, { type: outputMime, lastModified: file.lastModified });
}

// Prepares a batch in order; one refused file refuses the whole batch so
// nothing is half-sent.
export async function prepareImageUploads(files, options = {}) {
  const prepared = [];
  for (const file of files ?? []) prepared.push(await prepareImageUpload(file, options));
  return prepared;
}
