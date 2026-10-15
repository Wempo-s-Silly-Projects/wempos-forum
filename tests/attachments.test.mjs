// Unit tests for sniffImageMime (api/shared.mjs), the upload magic-byte gate.
// Later attachments tasks append to this file; keep it a plain unit test of
// the export with no worker fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { sniffImageMime } from "../api/shared.mjs";

test("accepts a GIF89a header as image/gif", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
  assert.equal(sniffImageMime(bytes), "image/gif");
});

test("accepts a GIF87a header as image/gif", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
  assert.equal(sniffImageMime(bytes), "image/gif");
});

test("rejects a header-mutated GIF signature (GIF8\\x00\\x00)", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
  assert.equal(sniffImageMime(bytes), null);
});

test("rejects a 5-byte GIF header (below the 12-byte minimum)", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]);
  assert.equal(sniffImageMime(bytes), null);
});

test("keeps pinning the JPEG, PNG, and WebP happy paths", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffImageMime(jpeg), "image/jpeg");
  assert.equal(sniffImageMime(png), "image/png");
  assert.equal(sniffImageMime(webp), "image/webp");
});