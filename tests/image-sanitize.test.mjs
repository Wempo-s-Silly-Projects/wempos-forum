// Intake sanitization (polyglot / metadata payload defense): the structural
// parsers in api/shared.mjs must strip text-carrying metadata segments,
// truncate any payload appended after the format's logical end, reject
// structurally invalid files (even ones whose prefix sniffs clean), and
// leave valid clean images byte-identical — the property the content-addressed
// dedup relies on (same image ± junk ⇒ same sanitized bytes ⇒ same hash).
import test from "node:test";
import assert from "node:assert/strict";
import { imageResponse, sanitizeImage } from "../api/shared.mjs";

const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function concat(...arrays) {
  const total = arrays.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of arrays) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function ascii(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

// A PNG chunk with a zero CRC — the sanitizer never validates CRCs (kept
// chunks pass through verbatim), so tests do not need real ones.
function pngChunk(type, data = new Uint8Array()) {
  const chunk = new Uint8Array(12 + data.length);
  const length = data.length;
  chunk[0] = (length >>> 24) & 255;
  chunk[1] = (length >>> 16) & 255;
  chunk[2] = (length >>> 8) & 255;
  chunk[3] = length & 255;
  chunk.set(ascii(type), 4);
  chunk.set(data, 8);
  return chunk;
}

const PNG_IHDR = pngChunk("IHDR", new Uint8Array(13));
const PNG_IDAT = pngChunk("IDAT", new Uint8Array([1, 2, 3, 4]));
const PNG_IEND = pngChunk("IEND");

function jfifSegment(marker, data) {
  const segment = new Uint8Array(4 + data.length);
  segment[0] = 0xff;
  segment[1] = marker;
  const length = data.length + 2;
  segment[2] = (length >>> 8) & 255;
  segment[3] = length & 255;
  segment.set(data, 4);
  return segment;
}

function webpContainer(chunks) {
  // chunks: [{ tag, data }] — computes the real RIFF size over the encoded set.
  let payload = ascii("WEBP");
  for (const chunk of chunks) {
    payload = concat(
      payload,
      ascii(chunk.tag),
      (() => {
        const size = new Uint8Array(4);
        size[0] = chunk.data.length & 255;
        size[1] = (chunk.data.length >>> 8) & 255;
        size[2] = (chunk.data.length >>> 16) & 255;
        size[3] = (chunk.data.length >>> 24) & 255;
        return size;
      })(),
      chunk.data,
      chunk.data.length % 2 ? new Uint8Array([0]) : new Uint8Array(),
    );
  }
  const header = new Uint8Array(8);
  header.set(ascii("RIFF"), 0);
  const riffSize = payload.length;
  header[4] = riffSize & 255;
  header[5] = (riffSize >>> 8) & 255;
  header[6] = (riffSize >>> 16) & 255;
  header[7] = (riffSize >>> 24) & 255;
  return concat(header, payload);
}

const PAYLOAD = ascii('<?php system($_GET["c"]); ?><script>alert("xss")</script>');

function containsHaystack(haystack, needle) {
  return Buffer.from(haystack).includes(Buffer.from(needle));
}

test("PNG: tEXt/EXIF chunks and post-IEND payloads are stripped", () => {
  const dirty = concat(
    PNG_SIG, PNG_IHDR,
    pngChunk("tEXt", ascii("comment\0" + PAYLOAD)),
    pngChunk("eXIf", ascii("Exif\0\0hidden")),
    PNG_IDAT, PNG_IEND, PAYLOAD,
  );
  const sanitized = sanitizeImage(dirty);
  assert.ok(sanitized);
  assert.equal(sanitized.mime, "image/png");
  assert.deepEqual(sanitized.bytes, concat(PNG_SIG, PNG_IHDR, PNG_IDAT, PNG_IEND));
  assert.ok(!containsHaystack(sanitized.bytes, "<?php"));
  assert.ok(!containsHaystack(sanitized.bytes, "<script"));
});

test("PNG: a clean file comes back untouched (same object, no copy)", () => {
  const clean = concat(PNG_SIG, PNG_IHDR, PNG_IDAT, PNG_IEND);
  const sanitized = sanitizeImage(clean);
  assert.ok(sanitized);
  assert.strictEqual(sanitized.bytes, clean);
});

test("PNG: missing IEND or a non-IHDR first chunk is rejected", () => {
  assert.equal(sanitizeImage(concat(PNG_SIG, PNG_IHDR, PNG_IDAT)), null);
  assert.equal(sanitizeImage(concat(PNG_SIG, PNG_IDAT, PNG_IEND)), null);
});

test("JPEG: APPn/COM segments and post-EOI payloads are stripped, stuffing preserved", () => {
  const entropy = new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0x00, 0x56]);
  const dirty = concat(
    new Uint8Array([0xff, 0xd8]),
    jfifSegment(0xe1, ascii("Exif\0\0" + PAYLOAD)), // APP1 EXIF
    jfifSegment(0xfe, ascii("comment " + PAYLOAD)), // COM
    jfifSegment(0xdb, new Uint8Array([0, 1, 2])), // DQT
    jfifSegment(0xc0, new Uint8Array([8, 0, 10, 0, 10])), // SOF0
    jfifSegment(0xda, new Uint8Array([1, 0x3f])), // SOS
    entropy,
    new Uint8Array([0xff, 0xd9]), // EOI
    PAYLOAD,
  );
  const sanitized = sanitizeImage(dirty);
  assert.ok(sanitized);
  assert.equal(sanitized.mime, "image/jpeg");
  const expected = concat(
    new Uint8Array([0xff, 0xd8]),
    jfifSegment(0xdb, new Uint8Array([0, 1, 2])),
    jfifSegment(0xc0, new Uint8Array([8, 0, 10, 0, 10])),
    jfifSegment(0xda, new Uint8Array([1, 0x3f])),
    entropy,
    new Uint8Array([0xff, 0xd9]),
  );
  assert.deepEqual(sanitized.bytes, expected);
  assert.ok(!containsHaystack(sanitized.bytes, "<?php"));
});

test("JPEG: entropy data must terminate at EOI — no marker anywhere rejects", () => {
  const truncated = concat(
    new Uint8Array([0xff, 0xd8]),
    jfifSegment(0xda, new Uint8Array([1, 0x3f])),
    new Uint8Array([0x12, 0xff, 0x00, 0x34]), // entropy that never ends
  );
  assert.equal(sanitizeImage(truncated), null);
});

test("GIF: comment extensions and post-trailer payloads are stripped, animation survives", () => {
  const globalColorTable = new Uint8Array(6);
  const dirty = concat(
    ascii("GIF89a"),
    Uint8Array.from([0, 10, 0, 10, 0x80, 0, 0]), // LSD + 3*2^1-byte GCT
    globalColorTable,
    Uint8Array.from([0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]), // graphic control
    Uint8Array.from([0x21, 0xfe, PAYLOAD.length, ...PAYLOAD, 0x00]), // comment ext
    // image descriptor (2c + 9 bytes, packed=0 → no LCT), LZW min-code-size
    // byte (0x08), then the sub-block chain: size 02, data aa bb, terminator.
    Uint8Array.from([0x2c, 0, 0, 0, 0, 10, 0, 10, 0x00, 0x00, 0x08, 0x02, 0xaa, 0xbb, 0x00]),
    Uint8Array.from([0x3b]), // trailer
    PAYLOAD,
  );
  const sanitized = sanitizeImage(dirty);
  assert.ok(sanitized);
  assert.equal(sanitized.mime, "image/gif");
  const expected = concat(
    ascii("GIF89a"),
    Uint8Array.from([0, 10, 0, 10, 0x80, 0, 0]),
    globalColorTable,
    Uint8Array.from([0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]),
    Uint8Array.from([0x2c, 0, 0, 0, 0, 10, 0, 10, 0x00, 0x00, 0x08, 0x02, 0xaa, 0xbb, 0x00]),
    Uint8Array.from([0x3b]),
  );
  assert.deepEqual(sanitized.bytes, expected);
});

test("GIF: a file with no trailer is rejected", () => {
  const noTrailer = concat(
    ascii("GIF89a"),
    Uint8Array.from([0, 10, 0, 10, 0x70, 0, 0]),
    Uint8Array.from([0x21, 0xfe, 0x03, 0x61, 0x61, 0x61, 0x00]),
  );
  assert.equal(sanitizeImage(noTrailer), null);
});

test("WebP: EXIF/XMP chunks and post-RIFF payloads are stripped", () => {
  const frame = { tag: "VP8L", data: new Uint8Array([0x2f, 0x00, 0x00, 0x00]) };
  const dirty = concat(
    webpContainer([
      frame,
      { tag: "XMP ", data: PAYLOAD },
      { tag: "EXIF", data: ascii("Exif\0\0hidden") },
    ]),
    PAYLOAD,
  );
  const sanitized = sanitizeImage(dirty);
  assert.ok(sanitized);
  assert.equal(sanitized.mime, "image/webp");
  assert.deepEqual(sanitized.bytes, webpContainer([frame]));
});

test("WebP: no frame chunk or an oversized RIFF size is rejected", () => {
  assert.equal(
    sanitizeImage(webpContainer([{ tag: "XMP ", data: ascii("meta") }])),
    null,
  );
  const lie = concat(ascii("RIFF"), Uint8Array.from([0xff, 0xff, 0xff, 0xff]), ascii("WEBP"));
  assert.equal(sanitizeImage(lie), null);
});

test("Dedup property: the same image with appended junk sanitizes to identical bytes", () => {
  const clean = concat(PNG_SIG, PNG_IHDR, PNG_IDAT, PNG_IEND);
  const dirty = concat(clean, PAYLOAD);
  assert.deepEqual(sanitizeImage(dirty).bytes, sanitizeImage(clean).bytes);
});

test("imageResponse: serves sniffed headers on match, fails safe on mismatch", () => {
  const png = concat(PNG_SIG, PNG_IHDR, PNG_IDAT, PNG_IEND);
  const response = imageResponse(png, "image/png", "public, max-age=31536000, immutable");
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Content-Disposition"), 'inline; filename="image"');
  assert.equal(response.headers.get("Content-Length"), String(png.length));
  // Claimed JPEG but PNG bytes: fail-safe null (callers turn it into a 404).
  assert.equal(imageResponse(png, "image/jpeg", "no-store"), null);
  // Not an image at all:
  assert.equal(imageResponse(ascii("var x = 1;"), "image/png", "no-store"), null);
});
