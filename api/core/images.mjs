// v4.0 core leaf: image intake sanitization (polyglot / metadata payload
// defense), magic-byte sniffing, and egress re-verification. Imports only
// the crypto leaf (random tokens) and the http leaf (HttpError,
// securityHeaders). Everything here is pure byte work — no D1, no session.
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
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) &&
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

// PNG: chunk walk. First chunk must be IHDR; text/EXIF-carrying ancillary
// chunks are dropped; everything else (IDAT, PLTE, tRNS, iCCP, gAMA, pHYs…)
// passes through with its CRC intact; the file must reach IEND, and any
// bytes after IEND (the classic append vector) are truncated away.
const PNG_DROP_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function sanitizePng(bytes) {
  const keep = [[0, 8]];
  let offset = 8;
  let seenIhdr = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes[offset] * 2 ** 24 + bytes[offset + 1] * 2 ** 16 +
      bytes[offset + 2] * 2 ** 8 + bytes[offset + 3];
    if (length > bytes.length - offset - 12) return null;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (type !== "IHDR" && !seenIhdr) return null;
    seenIhdr = true;
    const total = 12 + length;
    if (type === "IEND") {
      keep.push([offset, offset + total]);
      return assembleSanitized(bytes, keep);
    }
    if (!PNG_DROP_CHUNKS.has(type)) keep.push([offset, offset + total]);
    offset += total;
  }
  return null; // never reached IEND
}

// JPEG: marker walk. APPn (EXIF/XMP/...) and COM segments are dropped; SOF,
// DHT, DQT, DRI, SOS and entropy data pass through with byte stuffing (FF 00)
// and restart markers respected; the scan must reach EOI, and bytes after it
// are truncated. Handles progressive JPEGs (multiple SOS scans).
function jpegEntropyEnd(bytes, from) {
  let at = from;
  while (at + 1 < bytes.length) {
    if (bytes[at] === 0xff) {
      const next = bytes[at + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        at += 2;
        continue;
      }
      return at; // index of the 0xFF starting the next real marker
    }
    at += 1;
  }
  return -1; // stream ends without a marker: no EOI anywhere
}

function sanitizeJpeg(bytes) {
  const keep = [[0, 2]]; // SOI
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill bytes before a marker are legal
      continue;
    }
    if (marker === 0xd9) {
      keep.push([offset, offset + 2]); // EOI: the logical end of the image
      return assembleSanitized(bytes, keep);
    }
    if (marker === 0xd8 || marker < 0xc0) return null; // second SOI / marker invalid at this position
    if (offset + 4 > bytes.length) return null;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return null;
    if (marker === 0xda) {
      // SOS: keep the header segment, then the entropy-coded scan up to the
      // next real marker (EOI, or the next scan's DHT/SOS in progressive).
      keep.push([offset, offset + 2 + segmentLength]);
      const entropyStart = offset + 2 + segmentLength;
      const stop = jpegEntropyEnd(bytes, entropyStart);
      if (stop === -1) return null;
      keep.push([entropyStart, stop]);
      offset = stop;
      continue;
    }
    const drop = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe; // APPn + COM
    if (!drop) keep.push([offset, offset + 2 + segmentLength]);
    offset += 2 + segmentLength;
  }
  return null; // ran out of bytes before EOI
}

// GIF: block walk. Comment (0x21 0xFE) and plaintext (0x21 0x01) extensions
// are dropped; graphic control (0x21 0xF9) and application extensions
// (0x21 0xFF — the animation loop) survive, as do image descriptors with
// their color tables and LZW data; the file must reach its trailer (0x3B),
// and bytes after it are truncated.
function gifSubBlocksEnd(bytes, from) {
  let at = from;
  while (at < bytes.length) {
    const size = bytes[at];
    at += 1;
    if (size === 0) return at;
    at += size;
  }
  return -1; // sub-block chain never terminated
}

function sanitizeGif(bytes) {
  const packed = bytes[10];
  const colorTableBytes = (packed & 0x80) ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
  let offset = 13 + colorTableBytes;
  const keep = [[0, offset]]; // header + logical screen descriptor (+ global color table)
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x3b) {
      keep.push([offset, offset + 1]); // trailer: the logical end
      return assembleSanitized(bytes, keep);
    }
    if (block === 0x21) {
      if (offset + 1 >= bytes.length) return null;
      const label = bytes[offset + 1];
      const end = gifSubBlocksEnd(bytes, offset + 2);
      if (end === -1) return null;
      if (label !== 0xfe && label !== 0x01) keep.push([offset, end]);
      offset = end;
      continue;
    }
    if (block === 0x2c) {
      if (offset + 10 > bytes.length) return null;
      const localTable = (bytes[offset + 9] & 0x80) ? 3 * 2 ** ((bytes[offset + 9] & 0x07) + 1) : 0;
      // Image data = LZW minimum-code-size byte, THEN the sub-block chain —
      // the +1 skips that bare code-size byte before the first size byte.
      const end = gifSubBlocksEnd(bytes, offset + 10 + localTable + 1);
      if (end === -1) return null;
      keep.push([offset, end]);
      offset = end;
      continue;
    }
    return null; // unknown block byte
  }
  return null; // never reached the trailer
}

// WebP: RIFF chunk walk bounded by the declared RIFF size. EXIF/XMP chunks
// are dropped; frame/animation chunks (VP8, VP8L, VP8X, ANIM/ANMF, ALPH)
// survive; at least one frame chunk must be present, and bytes past the RIFF
// end are truncated.
function sanitizeWebp(bytes) {
  const riffSize = bytes[4] + bytes[5] * 2 ** 8 + bytes[6] * 2 ** 16 + bytes[7] * 2 ** 24;
  const riffEnd = 8 + riffSize;
  if (riffSize < 4 || riffEnd > bytes.length) return null;
  const keep = [[0, 12]];
  let offset = 12;
  let sawFrame = false;
  while (offset + 8 <= riffEnd) {
    const tag = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = bytes[offset + 4] + bytes[offset + 5] * 2 ** 8 +
      bytes[offset + 6] * 2 ** 16 + bytes[offset + 7] * 2 ** 24;
    const total = 8 + size + (size % 2); // RIFF chunks are padded to even sizes
    if (offset + total > riffEnd) return null;
    if (tag === "VP8 " || tag === "VP8L" || tag === "VP8X") sawFrame = true;
    if (tag !== "EXIF" && tag !== "XMP ") keep.push([offset, offset + total]);
    offset += total;
  }
  if (offset !== riffEnd || !sawFrame) return null;
  const output = assembleSanitized(bytes, keep);
  if (output === bytes) return output;
  // Bytes were dropped: rewrite the RIFF size field to match, or the
  // container would claim more data than it holds.
  const newSize = output.length - 8;
  output[4] = newSize & 255;
  output[5] = (newSize >>> 8) & 255;
  output[6] = (newSize >>> 16) & 255;
  output[7] = (newSize >>> 24) & 255;
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

// Egress for stored image bytes. The row's claimed MIME is re-verified
// against the bytes' magic signature at serve time — a mismatch (corrupt or
// tampered storage) fails SAFE as null, which every serving route turns into
// its own 404. Matched bytes get the full defensive set: the sniffed
// Content-Type (never a stored string alone), nosniff so browsers cannot
// guess the type, and Content-Disposition: inline with a fixed ASCII
// filename so no execution context is ever inherited from the path.
export function imageResponse(bytes, claimedMime, cacheControl) {
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
