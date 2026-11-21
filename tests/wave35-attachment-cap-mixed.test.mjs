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

// Wave 2026-11-21-35 F1 — re-check of the wave-31 early attachment cap with
// images and library GIFs interleaved in one multipart body. Exactly the cap
// (any mix) gets past the count gate; the first part past the cap is refused
// before it is read, sanitized or hash-looked-up, whichever kind it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { MAX_ATTACHMENT_FILES, readComposedBody } from "../api/attachments.mjs";

const CAP_MESSAGE = /Attach up to/;
const GIF_MISSING = /GIFs is not available/;

const pngChunk = (type, data) => {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const PNG = concat(
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
  pngChunk("IDAT", Uint8Array.from([0])),
  pngChunk("IEND", new Uint8Array(0)),
);

function countingEnv() {
  const env = makeEnv();
  const real = env.FORUM_DB;
  const seen = { hashLookups: 0 };
  const db = Object.create(real);
  db.prepare = (sql) => {
    if (/FROM revoked_attachment_hashes WHERE hash = \?/.test(sql)) seen.hashLookups += 1;
    return real.prepare(sql);
  };
  return { env: { ...env, FORUM_DB: db }, seen };
}

// pattern: "i" = image part, "g" = library GIF id part, in order.
function mixedRequest(pattern) {
  const form = new FormData();
  form.append("body", "hello");
  [...pattern].forEach((kind, index) => {
    if (kind === "i") form.append("images", new File([PNG], "x" + index + ".png", { type: "image/png" }));
    else form.append("gifIds", "00000000-0000-0000-0000-00000000000" + index);
  });
  return new Request("https://wempos-forum.com/api/posts", { method: "POST", body: form });
}

test("mixed cap: exactly the cap in any image/GIF mix passes the count gate", async () => {
  assert.equal(MAX_ATTACHMENT_FILES, 3);
  for (const pattern of ["iig", "igi", "gii", "ggi", "gig"]) {
    const { env, seen } = countingEnv();
    // The unseeded GIF ids then fail resolution — proof the cap let them by.
    await assert.rejects(readComposedBody(mixedRequest(pattern), env),
      (error) => error.status === 400 && GIF_MISSING.test(error.message), pattern);
    assert.equal(seen.hashLookups, [...pattern].filter((kind) => kind === "i").length, pattern);
  }
});

test("mixed cap: the part past the cap is refused before processing, image or GIF", async () => {
  for (const pattern of ["iigi", "iiig", "igig", "ggig", "gggi", "igiiii"]) {
    const { env, seen } = countingEnv();
    await assert.rejects(readComposedBody(mixedRequest(pattern), env),
      (error) => error.status === 400 && CAP_MESSAGE.test(error.message), pattern);
    const imagesWithinCap = [...pattern.slice(0, MAX_ATTACHMENT_FILES)].filter((kind) => kind === "i").length;
    assert.equal(seen.hashLookups, imagesWithinCap, pattern);
  }
});
