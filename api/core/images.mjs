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

// v4.0 core leaf: image intake sanitization (polyglot / metadata payload
// defense), magic-byte sniffing, and egress re-verification. Imports the
// crypto leaf (random tokens), the http leaf (HttpError, securityHeaders) and
// two pure byte libraries (file-type, image-dimensions). Everything here is
// pure byte work — no D1 queries run here, no session.
import { fileTypeFromBuffer } from "file-type";
import { imageDimensionsFromData } from "image-dimensions";
import { randomToken } from "./crypto.mjs";
import { HttpError, securityHeaders } from "./http.mjs";

export function createAvatarVersion() {
  return randomToken(12);
}

export function blobToUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new HttpError(500, "Stored picture data is invalid.");
}

export function sniffImageMime(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "image/jpeg";

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "image/png";

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) return "image/webp";

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) return "image/gif";

  return null;
}

// ---- Intake sanitization (polyglot / metadata payload defense) ----
//
// A magic-byte prefix says "this starts as an image", not "this is only an
// image". Classic smuggle vectors: a script payload appended AFTER the
// format's logical end (post-IEND/post-EOI bytes ride along because the
// header still sniffs clean), and payload text hidden in metadata segments
// (JPEG APPn/COM — EXIF, XMP, comments; PNG tEXt/zTXt/iTXt/eXIf; GIF
// comment extensions; WebP EXIF/XMP chunks). None of that executes inside a
// Worker (bytes are served, never interpreted) — but stored payloads are
// hygiene debt for anyone who later downloads or re-hosts the file, and they
// break content-addressed dedup (the same photo plus a hidden payload hashes
// differently). So intake now structurally PARSES each format: drop the
// metadata segments, truncate at the logical end, and REJECT anything that
// never reaches one (a truncated or malformed file fails even though its
// prefix sniffs fine). Kept bytes are copied verbatim — chunk CRCs, entropy
// data, animation extensions, and color profiles all survive untouched, so
// no re-encode (no WASM dependency) and no valid image is altered.
//
// Returns { bytes, mime } on success (bytes is the ORIGINAL object when
// nothing needed stripping) or null when the structure is invalid — callers
// translate that into their own 400.

// Rebuilds the byte set from the kept [start, end) slices. Returns the
// original object when nothing was dropped, so clean uploads cost no copy.
function assembleSanitized(bytes, keep) {
  let total = 0;
  for (const [start, end] of keep) total += end - start;
  if (total === bytes.length) return bytes;
  const output = new Uint8Array(total);
  let at = 0;
  for (const [start, end] of keep) {
    output.set(bytes.subarray(start, end), at);
    at += end - start;
  }
  return output;
}


const PNG_DROP_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function readU32BE(bytes, offset) {
  return bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3];
}

function readU32LE(bytes, offset) {
  return bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000;
}

function crc32(bytes, start, end) {
  let crc = 0xffffffff;

  for (let i = start; i < end; i += 1) {
    crc ^= bytes[i];

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function sanitizePng(bytes) {
  const keep = [[0, 8]];
  let offset = 8;
  let seenIhdr = false;
  let seenPlte = false;
  let seenIdat = false;
  let idatEnded = false;
  let seenIend = false;
  let colorType = -1;

  while (offset + 12 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    if (length > bytes.length - offset - 12) return null;

    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (!/^[A-Za-z]{4}$/.test(type)) return null;

    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;

    // Verify every chunk CRC before retaining or discarding it.
    if (crc32(bytes, offset + 4, dataEnd) !== readU32BE(bytes, dataEnd)) {
      return null;
    }

    const isCritical = (bytes[offset + 4] & 0x20) === 0;

    if (!seenIhdr) {
      if (type !== "IHDR" || length !== 13) return null;
      seenIhdr = true;

      const width = readU32BE(bytes, dataStart);
      const height = readU32BE(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filter = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];

      if (width === 0 || height === 0) return null;
      if (compression !== 0 || filter !== 0 || interlace > 1) return null;

      const validDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };

      if (!validDepths[colorType]?.includes(bitDepth)) return null;

      keep.push([offset, chunkEnd]);
      offset = chunkEnd;
      continue;
    }

    if (type === "IHDR") return null;

    if (type === "PLTE") {
      if (seenPlte || seenIdat || length === 0 || length > 768 || length % 3 !== 0) {
        return null;
      }
      if (colorType === 0 || colorType === 4) return null;
      if (colorType === 3 && length / 3 > 2 ** bytes[dataStart + 8]) {
        return null;
      }
      seenPlte = true;
    }

    if (type === "IDAT") {
      if (idatEnded) return null;
      seenIdat = true;
    } else if (seenIdat) {
      idatEnded = true;
    }

    if (type === "IEND") {
      if (length !== 0 || !seenIdat) return null;
      if (colorType === 3 && !seenPlte) return null;

      keep.push([offset, chunkEnd]);
      seenIend = true;
      break;
    }

    // Unknown critical chunks cannot safely be discarded or interpreted.
    if (isCritical && !["PLTE", "IDAT"].includes(type)) return null;

    if (!PNG_DROP_CHUNKS.has(type)) {
      keep.push([offset, chunkEnd]);
    }

    offset = chunkEnd;
  }

  if (!seenIhdr || !seenIdat || !seenIend) return null;
  return assembleSanitized(bytes, keep);
}

function jpegEntropyEnd(bytes, from) {
  let at = from;

  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }

    const next = bytes[at + 1];

    // Byte stuffing and restart markers belong to the entropy stream.
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      at += 2;
      continue;
    }

    return at;
  }

  return -1;
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function sanitizeJpeg(bytes) {
  const keep = [[0, 2]];
  let offset = 2;
  let seenFrame = false;
  let seenScan = false;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;

    // Consume legal marker fill bytes.
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= bytes.length) return null;

    const marker = bytes[offset];
    const markerStart = offset - 1;

    if (marker === 0x00) return null;

    if (marker === 0xd9) {
      if (!seenFrame || !seenScan) return null;
      keep.push([markerStart, offset + 1]);
      return assembleSanitized(bytes, keep);
    }

    // SOI cannot occur inside a JPEG image. TEM and restart markers
    // are standalone markers, but restart markers outside scans are invalid.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return null;

    if (marker === 0x01) {
      keep.push([markerStart, offset + 1]);
      offset += 1;
      continue;
    }

    if (offset + 3 >= bytes.length) return null;

    const segmentLength = (bytes[offset + 1] << 8) | bytes[offset + 2];
    if (segmentLength < 2 || segmentLength > bytes.length - offset - 1) {
      return null;
    }

    const segmentEnd = offset + 1 + segmentLength;
    const payloadStart = offset + 3;

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (seenFrame || segmentLength < 8) return null;

      const precision = bytes[payloadStart];
      const height = (bytes[payloadStart + 1] << 8) | bytes[payloadStart + 2];
      const width = (bytes[payloadStart + 3] << 8) | bytes[payloadStart + 4];
      const components = bytes[payloadStart + 5];

      if (
        precision === 0 || width === 0 || height === 0 ||
        components === 0 || components > 4 ||
        segmentLength !== 8 + components * 3
      ) {
        return null;
      }

      seenFrame = true;
    }

    if (marker === 0xda) {
      if (!seenFrame || segmentLength < 8) return null;

      const components = bytes[payloadStart];
      if (
        components === 0 || components > 4 ||
        segmentLength !== 6 + components * 2
      ) {
        return null;
      }

      keep.push([markerStart, segmentEnd]);

      const entropyStart = segmentEnd;
      const stop = jpegEntropyEnd(bytes, entropyStart);
      if (stop === -1) return null;

      keep.push([entropyStart, stop]);
      seenScan = true;
      offset = stop;
      continue;
    }

    // APPn and COM segments are the metadata-bearing segments removed here.
    const drop = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;

    if (!drop) keep.push([markerStart, segmentEnd]);

    offset = segmentEnd;
  }

  return null;
}

function gifSubBlocksEnd(bytes, from) {
  let at = from;

  while (at < bytes.length) {
    const size = bytes[at];
    at += 1;

    if (size === 0) return at;
    if (size > bytes.length - at) return -1;

    at += size;
  }

  return -1;
}

function sanitizeGif(bytes) {
  if (bytes.length < 13) return null;

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  if (width === 0 || height === 0) return null;

  const packed = bytes[10];
  const colorTableBytes = (packed & 0x80)
    ? 3 * 2 ** ((packed & 0x07) + 1)
    : 0;

  let offset = 13 + colorTableBytes;
  if (offset > bytes.length) return null;

  const keep = [[0, offset]];
  let imageCount = 0;

  while (offset < bytes.length) {
    const block = bytes[offset];

    if (block === 0x3b) {
      if (imageCount === 0) return null;

      keep.push([offset, offset + 1]);
      return assembleSanitized(bytes, keep);
    }

    if (block === 0x21) {
      if (offset + 2 > bytes.length) return null;

      const label = bytes[offset + 1];
      const end = gifSubBlocksEnd(bytes, offset + 2);
      if (end === -1) return null;

      // Only known extension types are accepted.
      if (![0xf9, 0xfe, 0x01, 0xff].includes(label)) return null;

      // Graphic Control Extension has exactly one four-byte data block.
      if (label === 0xf9) {
        if (
          bytes[offset + 2] !== 4 ||
          end !== offset + 8 ||
          bytes[offset + 7] !== 0
        ) {
          return null;
        }
      }

      // Plain Text and Application extensions have fixed-size headers.
      if (label === 0x01 && bytes[offset + 2] !== 12) return null;
      if (label === 0xff && bytes[offset + 2] !== 11) return null;

      if (label !== 0xfe && label !== 0x01) {
        keep.push([offset, end]);
      }

      offset = end;
      continue;
    }

    if (block === 0x2c) {
      if (offset + 10 > bytes.length) return null;

      const imageWidth = bytes[offset + 5] | (bytes[offset + 6] << 8);
      const imageHeight = bytes[offset + 7] | (bytes[offset + 8] << 8);
      const imagePacked = bytes[offset + 9];

      if (imageWidth === 0 || imageHeight === 0) return null;

      const localTableBytes = (imagePacked & 0x80)
        ? 3 * 2 ** ((imagePacked & 0x07) + 1)
        : 0;

      const codeSizeOffset = offset + 10 + localTableBytes;
      if (codeSizeOffset >= bytes.length) return null;

      const codeSize = bytes[codeSizeOffset];
      if (codeSize < 2 || codeSize > 8) return null;

      const end = gifSubBlocksEnd(bytes, codeSizeOffset + 1);
      if (end === -1) return null;

      keep.push([offset, end]);
      imageCount += 1;
      offset = end;
      continue;
    }

    return null;
  }

  return null;
}

function sanitizeWebp(bytes) {
  if (bytes.length < 12) return null;

  const riffSize = readU32LE(bytes, 4);
  const riffEnd = 8 + riffSize;

  if (riffSize < 4 || riffEnd > bytes.length) return null;

  const keep = [[0, 12]];
  let offset = 12;
  let keptLength = 12;
  let vp8xOutputOffset = -1;
  let seenVp8x = false;
  let seenImage = false;
  let seenExif = false;
  let seenXmp = false;
  let removedExif = false;
  let removedXmp = false;

  while (offset + 8 <= riffEnd) {
    const tag = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );

    const size = readU32LE(bytes, offset + 4);
    const total = 8 + size + (size & 1);

    if (total > riffEnd - offset) return null;

    const chunkEnd = offset + total;

    if (tag === "VP8X") {
      if (seenVp8x || offset !== 12 || size !== 10) return null;
      seenVp8x = true;
      vp8xOutputOffset = keptLength;

      const flags = bytes[offset + 8];
      if (flags & 0xc1) return null;
    }

    if (["VP8 ", "VP8L", "ANMF"].includes(tag)) {
      seenImage = true;
    }

    if (tag === "EXIF") {
      if (seenExif) return null;
      seenExif = true;
      removedExif = true;
    }

    if (tag === "XMP ") {
      if (seenXmp) return null;
      seenXmp = true;
      removedXmp = true;
    }

    if (tag !== "EXIF" && tag !== "XMP ") {
      keep.push([offset, chunkEnd]);
      keptLength += total;
    }

    offset = chunkEnd;
  }

  if (offset !== riffEnd || !seenImage) return null;

  // Extended WebP metadata flags must agree with the chunks that remain.
  if (seenVp8x) {
    const flags = bytes[vp8xOutputOffset + 8];

    if (removedExif && !(flags & 0x08)) return null;
    if (removedXmp && !(flags & 0x04)) return null;
  } else if (removedExif || removedXmp) {
    // Metadata chunks require the extended WebP container.
    return null;
  }

  const output = assembleSanitized(bytes, keep);

  if (output !== bytes) {
    const newSize = output.length - 8;

    output[4] = newSize & 0xff;
    output[5] = (newSize >>> 8) & 0xff;
    output[6] = (newSize >>> 16) & 0xff;
    output[7] = (newSize >>> 24) & 0xff;

    if (vp8xOutputOffset !== -1) {
      const flagsOffset = vp8xOutputOffset + 8;

      if (removedExif) output[flagsOffset] &= ~0x08;
      if (removedXmp) output[flagsOffset] &= ~0x04;
    }
  }

  return output;
}



export function sanitizeImage(bytes) {
  const mime = sniffImageMime(bytes);
  if (!mime) return null;
  const sanitized = mime === "image/png" ? sanitizePng(bytes)
    : mime === "image/jpeg" ? sanitizeJpeg(bytes)
    : mime === "image/gif" ? sanitizeGif(bytes)
    : sanitizeWebp(bytes);
  if (!sanitized) return null;
  return { bytes: sanitized, mime };
}

// ---- Authoritative intake inspection (upload safety pipeline) ----
//
// Every image intake route calls inspectImageUpload on the raw upload bytes.
// Two independent detectors must agree before anything is stored: the
// structural sniffer above (which the sanitizer walks) and the file-type
// library's signature table. A renamed .exe/.html/.svg, a PDF, or anything
// the two disagree on is refused. The client's own checks are a courtesy;
// this is the gate. file-type reports an animated PNG as image/apng — the
// same PNG container, so it maps back to image/png.
const FILE_TYPE_ALIASES = Object.freeze({ "image/apng": "image/png" });

async function detectedMime(bytes) {
  try {
    const detected = await fileTypeFromBuffer(bytes);
    if (!detected) return null;
    return FILE_TYPE_ALIASES[detected.mime] ?? detected.mime;
  } catch {
    // A parser hard-limit or malformed-structure error from the library is a
    // "could not identify" answer, never a pass.
    return null;
  }
}

// Width/height from the header bytes alone (image-dimensions), or null when
// the header does not carry them. Used for <img width/height> so attachments
// reserve their box before the bytes arrive (no layout shift).
export function imageDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;
  let size;
  try {
    size = imageDimensionsFromData(bytes);
  } catch {
    return null;
  }
  if (!size || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height)) return null;
  if (size.width < 1 || size.height < 1) return null;
  return { width: size.width, height: size.height };
}

// Returns { mime, bytes, width, height } (bytes sanitized; width/height null
// when the header lacks them) or null when the upload is not an allowed image.
export async function inspectImageUpload(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;

  const mime = sniffImageMime(bytes);
  if (!mime) return null;

  if (await detectedMime(bytes) !== mime) return null;

  const sanitized = sanitizeImage(bytes);
  if (!sanitized || sanitized.mime !== mime) return null;

  const size = imageDimensions(sanitized.bytes);

  // A structurally valid image must also have usable dimensions.
  if (!size) return null;

  return {
    mime,
    bytes: sanitized.bytes,
    width: size.width,
    height: size.height,
  };
}

// Content-addressed dimensions row (migration 0080). INSERT OR IGNORE: the
// same clean bytes always have the same size, so the first writer wins.
// Returns null when there is nothing to record.
export function imageDimensionsStatement(db, hash, image) {
  if (!image?.width || !image?.height) return null;
  return db.prepare("INSERT OR IGNORE INTO image_dimensions (hash, width, height) VALUES (?, ?, ?)")
    .bind(hash, image.width, image.height);
}

// Egress for stored image bytes. The row's claimed MIME is re-verified
// against the bytes' magic signature at serve time — a mismatch (corrupt or
// tampered storage) fails SAFE as null, which every serving route turns into
// its own 404. Matched bytes get the full defensive set: the sniffed
// Content-Type (never a stored string alone), nosniff so browsers cannot
// guess the type, and Content-Disposition: inline with a fixed ASCII
// filename so no execution context is ever inherited from the path.
export function imageResponse(bytes, claimedMime, cacheControl) {
  if (!(bytes instanceof Uint8Array)) return null;

  const sniffed = sniffImageMime(bytes);
  if (!sniffed || sniffed !== claimedMime) return null;

  const headers = securityHeaders();
  headers.set("Content-Type", sniffed);
  headers.set("Cache-Control", cacheControl);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", 'inline; filename="image"');
  headers.set("Content-Length", String(bytes.length));

  return new Response(bytes, { status: 200, headers });
}
