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
//    flatten the animation.
// The compressor runs on the main thread (useWebWorker: false): its worker
// mode loads the library from a CDN, which would be a third-party request.
// It is imported lazily, same-origin, only when a photo is actually sent.

// Mirrors constants.mjs (pinned equal by tests/upload-safety.test.mjs).
export const UPLOAD_MAX_LONG_SIDE = 2560;
export const UPLOAD_TARGET_MAX_MB = 2;
export const UPLOAD_AVATAR_TARGET_MAX_MB = 1;

export const UPLOAD_IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// Enough to find an APNG acTL chunk behind a large colour profile.
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

// PNG: an acTL chunk before the first IDAT marks an APNG. A header that runs
// out before IDAT cannot be proven still, so it counts as animated (sent
// untouched; the Worker still strips its metadata).
function isAnimatedPng(bytes) {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = ascii(bytes, offset + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
    offset += 12 + length;
  }
  return true;
}

// WebP: the VP8X extended header's animation flag (bit 1 of its first byte).
const isAnimatedWebp = (bytes) => ascii(bytes, 12, 4) === "VP8X" && (bytes[20] & 0x02) !== 0;

export function isAnimatedImage(bytes, mime) {
  if (mime === "image/gif") return true;
  if (mime === "image/png") return isAnimatedPng(bytes);
  if (mime === "image/webp") return isAnimatedWebp(bytes);
  return false;
}

const readHeader = async (blob) => new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());

const loadCompressor = async (file, options) => {
  const { default: imageCompression } = await import("./vendor/browser-image-compression.mjs");
  return imageCompression(file, options);
};

const wrongTypeMessage = (name) => t("attachments.wrongType", { name });

// Returns the File to upload: the original (GIF, animated, or when the canvas
// path fails or yields something unusable) or the re-encoded, metadata-free
// copy under the original name. Throws an Error carrying a translated
// wrong-type message when the bytes are not an accepted image.
export async function prepareImageUpload(file, options = {}) {
  const {
    compress = loadCompressor,
    accept = UPLOAD_IMAGE_TYPES,
    maxSizeMB = UPLOAD_TARGET_MAX_MB,
    wrongType = wrongTypeMessage,
  } = options;
  const header = await readHeader(file);
  const mime = sniffUploadType(header);
  if (!mime || !accept.includes(mime)) throw new Error(wrongType(file.name));
  if (isAnimatedImage(header, mime)) return file;
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
    // No canvas, an undecodable image, or a browser quirk: send the original.
    // The Worker strips its metadata and refuses it if it is not an image.
    return file;
  }
  if (!(output instanceof Blob)) return file;
  const outputMime = sniffUploadType(await readHeader(output));
  if (!outputMime || !accept.includes(outputMime)) return file;
  return new File([output], file.name, { type: outputMime, lastModified: file.lastModified });
}

// Prepares a batch in order; one refused file refuses the whole batch so
// nothing is half-sent.
export async function prepareImageUploads(files, options = {}) {
  const prepared = [];
  for (const file of files ?? []) prepared.push(await prepareImageUpload(file, options));
  return prepared;
}
