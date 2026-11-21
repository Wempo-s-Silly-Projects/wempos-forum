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

import { t, tn } from "./i18n.js";
// Pure, DOM-free helpers for post/reply image attachments (plan Task 7).
// Both helpers are safe to import under node --test: no document access, and
// Node 22 (like every browser) ships File and FormData globals.

// Matches the server contract readComposedBody enforces (MAX_ATTACHMENT_FILES /
// MAX_ATTACHMENT_BYTES in api/attachments.mjs — 10 MiB since attachment bytes
// are chunked in D1) so the client can reject bad choices up front instead of
// discovering them in a 400/413 round trip. The server still validates
// everything; these are convenience limits only.
export const COMPOSER_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
export const MAX_COMPOSER_FILES = 3;
export const MAX_COMPOSER_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_COMPOSER_FILE_BYTES_LABEL = "10 MiB"; // i18n-ignore
const COMPOSER_IMAGE_TYPES = Object.freeze(COMPOSER_ACCEPT.split(","));

// Wave 30: pasted or dropped files skip the picker's accept filter, so the
// type check lives here beside the size and count caps — every route into the
// composer (picker, paste, drop) shares one gate. The server still sniffs the
// bytes; this only spares a doomed round trip.
export const isComposerImageType = (file) =>
  COMPOSER_IMAGE_TYPES.includes(String(file?.type ?? "").toLowerCase());

// Folds a picker selection into the composer's chosen list. Oversized choices
// are refused (with a per-file notice) and the 3-file cap is enforced with a
// notice rather than silently truncating, so the user can free a slot
// deliberately. Never mutates currentFiles; never throws.
export function addComposerFiles(currentFiles, pickedFiles) {
  const files = [...(currentFiles ?? [])];
  const notices = [];
  for (const picked of pickedFiles ?? []) {
    if (!isComposerImageType(picked)) {
      notices.push(t("attachments.wrongType", { name: picked.name }));
    } else if (picked.size > MAX_COMPOSER_FILE_BYTES) {
      notices.push(
        t("attachments.tooLarge", { name: picked.name, limit: MAX_COMPOSER_FILE_BYTES_LABEL }),
      );
    } else if (files.length >= MAX_COMPOSER_FILES) {
      notices.push(
        tn("attachments.tooMany", MAX_COMPOSER_FILES, { name: picked.name }),
      );
    } else {
      files.push(picked);
    }
  }
  return { files, notices };
}

// Builds the request body a post/reply composer submits through api():
// - files present → multipart/form-data (repeatable "images" parts plus the
//   "body"/"cf-turnstile-response" text fields Task 3's server accepts); api()
//   leaves FormData bodies alone (no JSON Content-Type).
// - no files → the exact pre-attachment JSON payload, byte-identical to what
//   the composers produced before attachments existed.
// - board (v2.4.1): the Suggestions composer tags root posts with their board
//   (JSON key / multipart text part, only when set). Replies never send one —
//   the server derives their board from the thread root.
export function buildComposerBody({ body, turnstileToken, files = [], gifs = [], board }) {
  // GIF references (v2.5): selected library gifs ride EITHER payload shape as
  // gifIds (repeatable fields in the multipart form; an array in JSON).
  if ((!Array.isArray(files) || files.length === 0) && (!Array.isArray(gifs) || gifs.length === 0)) {
    const payload = { body, "cf-turnstile-response": turnstileToken };
    if (board) payload.board = board;
    return { multipart: false, body: payload };
  }
  const form = new FormData();
  form.append("body", body);
  form.append("cf-turnstile-response", turnstileToken);
  if (board) form.append("board", board);
  for (const file of files) form.append("images", file, file.name);
  for (const gifId of Array.isArray(gifs) ? gifs : []) form.append("gifIds", gifId);
  return { multipart: true, body: form };
}

// Serving URL for one attachment metadata row ({ id, version }) from the post
// payloads Task 5 serializes. Approved rows are public with a year of
// immutable cache keyed by version; pending rows serve the author/mod
// under the same URL shape (private short cache).
export const attachmentUrl = (attachment) =>
  `/api/attachments/${attachment.id}?v=${encodeURIComponent(attachment.version)}`;
