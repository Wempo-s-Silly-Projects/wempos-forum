
// v4.0 core leaf: image intake sanitization (polyglot / metadata payload
// defense), magic-byte sniffing, and egress re-verification. Imports only
// the crypto leaf (random tokens) and the http leaf (HttpError,
// securityHeaders). Everything here is byte processing — no D1, no session.
import { randomToken } from "./crypto.mjs";
import { HttpError, securityHeaders } from "./http.mjs";

export function createAvatarVersion() {
  return randomToken(12);
}

export function blobToUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
  }

  if (Array.isArray(value)) {
    if (
      value.some(
        (byte) =>
          !Number.isInteger(byte) || byte < 0 || byte > 255,
      )
    ) {
      throw new HttpError(500, "Stored picture data is invalid.");
    }

    return Uint8Array.from(value);
  }

  throw new HttpError(500, "Stored picture data is invalid.");
}

export function sniffImageMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) {
    return null;
  }

  if (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }

  return null;
}

// ---- Shared byte helpers ----

// Rebuilds the byte set from the kept [start, end) slices. Returns the
// original object when nothing was dropped, avoiding a copy for clean files.
function assembleSanitized(bytes, keep) {
  let total = 0;

  for (const [start, end] of keep) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > bytes.length
    ) {
      return null;
    }

    total += end - start;
  }

  if (total === bytes.length) return bytes;

  const output = new Uint8Array(total);
  let at = 0;

  for (const [start, end] of keep) {
    output.set(bytes.subarray(start, end), at);
    at += end - start;
  }

  return output;
}

function readUint32BE(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readUint32LE(bytes, offset) {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function ascii(bytes, offset, length) {
  let result = "";

  for (let i = 0; i < length; i += 1) {
    result += String.fromCharCode(bytes[offset + i]);
  }

  return result;
}

// ---- PNG ----
//
// PNG chunk walk. The first chunk must be a 13-byte IHDR; duplicate IHDR,
// malformed IEND, invalid CRCs and unknown critical chunks are rejected.
// Text/EXIF/time chunks are dropped. Other chunks survive with their
// original CRCs. At least one IDAT chunk and a valid IEND are required.
// Bytes after IEND are discarded.

const PNG_DROP_CHUNKS = new Set([
  "tEXt",
  "zTXt",
  "iTXt",
  "eXIf",
  "tIME",
]);

const PNG_KNOWN_CRITICAL_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
]);

function pngCrc32(bytes, start, end) {
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
  let seenIdat = false;
  let idatEnded = false;

  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const chunkEnd = offset + 12 + length;

    if (chunkEnd > bytes.length) return null;

    const type = ascii(bytes, offset + 4, 4);

    if (!/^[A-Za-z]{4}$/.test(type)) return null;

    // The third chunk-type character's reserved bit must be zero.
    if (type.charCodeAt(2) & 0x20) return null;

    const storedCrc = readUint32BE(bytes, offset + 8 + length);
    const actualCrc = pngCrc32(bytes, offset + 4, offset + 8 + length);

    if (storedCrc !== actualCrc) return null;

    if (!seenIhdr) {
      if (type !== "IHDR" || length !== 13) return null;
      seenIhdr = true;
    } else if (type === "IHDR") {
      return null;
    }

    // Unknown critical chunks are not safe to pass through as if understood.
    if (
      !(type.charCodeAt(0) & 0x20) &&
      !PNG_KNOWN_CRITICAL_CHUNKS.has(type)
    ) {
      return null;
    }

    if (type === "IDAT") {
      if (idatEnded) return null;
      seenIdat = true;
    } else if (seenIdat && type !== "IEND") {
      idatEnded = true;
    }

    if (type === "IEND") {
      if (length !== 0 || !seenIdat) return null;

      keep.push([offset, chunkEnd]);
      return assembleSanitized(bytes, keep);
    }

    if (!PNG_DROP_CHUNKS.has(type)) {
      keep.push([offset, chunkEnd]);
    }

    offset = chunkEnd;
  }

  return null;
}

// ---- JPEG ----
//
// JPEG marker walk. APPn (EXIF/XMP/...) and COM segments are dropped.
// Frame and scan markers, quantization/Huffman tables, restart markers,
// and entropy-coded data survive. A valid frame and at least one scan
// must occur before EOI. Progressive JPEGs with multiple SOS scans work.

function jpegEntropyEnd(bytes, from) {
  let at = from;

  while (at + 1 < bytes.length) {
    if (bytes[at] === 0xff) {
      const next = bytes[at + 1];

      // Byte-stuffed FF and restart markers are part of the entropy stream.
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        at += 2;
        continue;
      }

      // The next non-entropy marker begins here.
      return at;
    }

    at += 1;
  }

  return -1;
}

function isJpegFrameMarker(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function sanitizeJpeg(bytes) {
  const keep = [[0, 2]];

  let offset = 2;
  let seenFrame = false;
  let seenScan = false;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;

    // Fill bytes before a marker are legal.
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) {
      offset += 1;
    }

    if (offset + 1 >= bytes.length) return null;

    const marker = bytes[offset + 1];

    if (marker === 0xd9) {
      if (!seenFrame || !seenScan) return null;

      keep.push([offset, offset + 2]);
      return assembleSanitized(bytes, keep);
    }

    // A second SOI, stuffed byte, restart marker outside a scan, or
    // reserved marker cannot appear as an ordinary segment here.
    if (
      marker === 0xd8 ||
      marker === 0x00 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      return null;
    }

    // TEM is a standalone marker.
    if (marker === 0x01) {
      keep.push([offset, offset + 2]);
      offset += 2;
      continue;
    }

    if (offset + 4 > bytes.length) return null;

    const segmentLength =
      (bytes[offset + 2] << 8) | bytes[offset + 3];

    if (
      segmentLength < 2 ||
      offset + 2 + segmentLength > bytes.length
    ) {
      return null;
    }

    const segmentEnd = offset + 2 + segmentLength;

    if (isJpegFrameMarker(marker)) {
      // SOF: precision, height, width, component count and component data.
      if (segmentLength < 8 || seenFrame) return null;

      const componentCount = bytes[offset + 9];

      if (
        componentCount < 1 ||
        segmentLength !== 8 + componentCount * 3
      ) {
        return null;
      }

      seenFrame = true;
    }

    if (marker === 0xda) {
      // SOS must describe at least one component and follow a frame.
      if (!seenFrame || segmentLength < 6) return null;

      const componentCount = bytes[offset + 4];

      if (
        componentCount < 1 ||
        segmentLength !== 6 + componentCount * 2
      ) {
        return null;
      }

      keep.push([offset, segmentEnd]);
      seenScan = true;

      const entropyStart = segmentEnd;
      const stop = jpegEntropyEnd(bytes, entropyStart);

      if (stop === -1) return null;

      keep.push([entropyStart, stop]);
      offset = stop;
      continue;
    }

    const drop =
      (marker >= 0xe0 && marker <= 0xef) ||
      marker === 0xfe;

    if (!drop) {
      keep.push([offset, segmentEnd]);
    }

    offset = segmentEnd;
  }

  return null;
}

// ---- GIF ----
//
// GIF block walk. Comment and plaintext extensions are dropped.
// Graphic-control and application extensions survive, as do image
// descriptors, color tables and LZW data. At least one image descriptor
// and a trailer are required. Bytes after the trailer are discarded.

function gifSubBlocksEnd(bytes, from) {
  let at = from;

  while (at < bytes.length) {
    const size = bytes[at];
    at += 1;

    if (size === 0) return at;

    if (at + size > bytes.length) return -1;

    at += size;
  }

  return -1;
}

function sanitizeGif(bytes) {
  if (bytes.length < 13) return null;

  const packed = bytes[10];
  const colorTableBytes = (packed & 0x80)
    ? 3 * 2 ** ((packed & 0x07) + 1)
    : 0;

  let offset = 13 + colorTableBytes;

  if (offset > bytes.length) return null;

  const keep = [[0, offset]];
  let seenImage = false;

  while (offset < bytes.length) {
    const block = bytes[offset];

    if (block === 0x3b) {
      if (!seenImage) return null;

      keep.push([offset, offset + 1]);
      return assembleSanitized(bytes, keep);
    }

    if (block === 0x21) {
      if (offset + 1 >= bytes.length) return null;

      const label = bytes[offset + 1];
      const end = gifSubBlocksEnd(bytes, offset + 2);

      if (end === -1) return null;

      // Comment and plaintext extensions can carry arbitrary text.
      if (label !== 0xfe && label !== 0x01) {
        keep.push([offset, end]);
      }

      offset = end;
      continue;
    }

    if (block === 0x2c) {
      // Image separator + descriptor.
      if (offset + 10 > bytes.length) return null;

      const imagePacked = bytes[offset + 9];
      const localTableBytes = (imagePacked & 0x80)
        ? 3 * 2 ** ((imagePacked & 0x07) + 1)
        : 0;

      const lzwSizeOffset = offset + 10 + localTableBytes;

      if (lzwSizeOffset >= bytes.length) return null;

      const end = gifSubBlocksEnd(bytes, lzwSizeOffset + 1);

      if (end === -1) return null;

      keep.push([offset, end]);
      seenImage = true;
      offset = end;
      continue;
    }

    return null;
  }

  return null;
}

// ---- WebP ----
//
// RIFF chunk walk bounded by the declared RIFF size. EXIF/XMP chunks are
// dropped. VP8X feature flags are updated to reflect removed metadata.
// At least one actual image-data chunk (VP8, VP8L or ANMF) is required.
// Bytes beyond the RIFF container are discarded.

function writeUint32LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function sanitizeWebp(bytes) {
  const riffSize = readUint32LE(bytes, 4);
  const riffEnd = 8 + riffSize;

  if (riffSize < 4 || riffEnd > bytes.length) return null;

  const keep = [[0, 12]];

  let offset = 12;
  let sawImageData = false;
  let sawVp8x = false;
  let vp8xFlagsOffset = -1;
  let removedExif = false;
  let removedXmp = false;

  while (offset + 8 <= riffEnd) {
    const tag = ascii(bytes, offset, 4);
    const size = readUint32LE(bytes, offset + 4);
    const paddedSize = size + (size % 2);
    const total = 8 + paddedSize;
    const chunkEnd = offset + total;

    if (chunkEnd > riffEnd) return null;

    // RIFF chunks with odd payload sizes have one padding byte.
    if (size % 2 && bytes[offset + 8 + size] !== 0) {
      return null;
    }

    if (offset === 12 && tag !== "VP8X" && tag !== "VP8 " && tag !== "VP8L") {
      // A simple WebP starts with image data; an extended WebP starts VP8X.
      // Other first-chunk types are not accepted here.
      return null;
    }

    if (tag === "VP8X") {
      if (sawVp8x || offset !== 12 || size !== 10) return null;

      sawVp8x = true;
      vp8xFlagsOffset = offset + 8;
    }

    if (tag === "VP8 " || tag === "VP8L" || tag === "ANMF") {
      sawImageData = true;
    }

    if (tag === "EXIF") {
      removedExif = true;
    } else if (tag === "XMP ") {
      removedXmp = true;
    } else {
      keep.push([offset, chunkEnd]);
    }

    offset = chunkEnd;
  }

  if (offset !== riffEnd || !sawImageData) return null;

  // EXIF/XMP are extended WebP features. Their presence requires VP8X.
  if ((removedExif || removedXmp) && !sawVp8x) return null;

  const output = assembleSanitized(bytes, keep);

  if (!output) return null;

  if (output !== bytes) {
    const newSize = output.length - 8;

    writeUint32LE(output, 4, newSize);

    if (vp8xFlagsOffset !== -1) {
      let flags = output[vp8xFlagsOffset];

      if (removedExif) flags &= ~0x08;
      if (removedXmp) flags &= ~0x04;

      output[vp8xFlagsOffset] = flags;
    }
  }

  return output;
}

// ---- Public intake API ----
//
// Returns { bytes, mime } on success, or null when the file is unsupported
// or structurally invalid. Kept bytes are copied verbatim; this is
// structural sanitization, not full decoding and re-encoding.

export function sanitizeImage(bytes) {
  const mime = sniffImageMime(bytes);

  if (!mime) return null;

  const sanitized =
    mime === "image/png"
      ? sanitizePng(bytes)
      : mime === "image/jpeg"
        ? sanitizeJpeg(bytes)
        : mime === "image/gif"
          ? sanitizeGif(bytes)
          : sanitizeWebp(bytes);

  if (!sanitized) return null;

  return {
    bytes: sanitized,
    mime,
  };
}

// ---- Egress ----
//
// The row's claimed MIME is re-verified against the actual bytes at serve
// time. A mismatch or invalid signature fails safely as null. The response
// uses a sniffed Content-Type, nosniff, and a fixed inline filename.

export function imageResponse(bytes, claimedMime, cacheControl) {
  const sniffed = sniffImageMime(bytes);

  if (!sniffed || sniffed !== claimedMime) return null;

  const headers = securityHeaders();

  headers.set("Content-Type", sniffed);
  headers.set("Cache-Control", cacheControl);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", 'inline; filename="image"');
  headers.set("Content-Length", String(bytes.length));

  return new Response(bytes, {
    status: 200,
    headers,
  });
}
