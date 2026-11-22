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

// Private notes about members (v5.47.0, migration 0072):
// GET/PUT/DELETE /api/users/:username/note. One note per (owner, subject);
// PUT upserts, DELETE removes (idempotent), an empty body is a 400 (use
// DELETE). Every statement is keyed on the SESSION's own id, so a note is
// visible only to its owner — never to the subject, other members, staff
// (no bypass) or guests. Unknown username = 404; yourself = 400.
//
// A banned or block-paired SUBJECT changes nothing: the note is the owner's
// own data, never shown to the subject, so the owner may still read, edit
// and delete it. A banned OWNER may read and delete but not write (PUT runs
// assertNotBanned; DELETE only removes their own row).
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { userByUsernameKey } from "./core/shapers.mjs";
import { isRefusedChar } from "./thread-summaries.mjs";
import { PRIVATE_NOTE_MAX_CHARS, PRIVATE_NOTES_MAX } from "../constants.mjs";

const NOTE_PATH = /^\/api\/users\/([^/]{1,200})\/note$/;
const NOTE_SELECT_SQL = "SELECT body, updated_at FROM private_notes WHERE owner_id = ? AND subject_id = ? LIMIT 1";
// Binds (5): owner, subject, body, now, owner (the cap). An edit of an
// existing note always applies (ON CONFLICT); a NEW subject only while the
// owner is under PRIVATE_NOTES_MAX, checked inside the same statement.
const NOTE_UPSERT_SQL =
  "INSERT INTO private_notes (owner_id, subject_id, body, updated_at) SELECT ?, ?, ?, ? " +
  "WHERE (SELECT COUNT(*) FROM private_notes WHERE owner_id = ?) < " + PRIVATE_NOTES_MAX + " " +
  "ON CONFLICT (owner_id, subject_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at";
const NOTE_UPDATE_SQL = "UPDATE private_notes SET body = ?, updated_at = ? WHERE owner_id = ? AND subject_id = ?";
const NOTE_DELETE_SQL = "DELETE FROM private_notes WHERE owner_id = ? AND subject_id = ?";

const notFound = () => new HttpError(404, "Member not found.");
const isoOf = (seconds) => new Date(Number(seconds) * 1000).toISOString();
const shapeNote = (row) => (row ? { body: row.body, updatedAt: isoOf(row.updated_at) } : null);

async function subjectFor(env, rawName, ownerId) {
  let username;
  try {
    username = decodeURIComponent(rawName);
  } catch {
    throw notFound();
  }
  const user = await userByUsernameKey(env, username.toLowerCase());
  if (!user) throw notFound();
  const subjectId = Number(user.id);
  if (subjectId === ownerId) throw new HttpError(400, "You cannot keep a note about yourself.");
  return subjectId;
}

function noteBody(value) {
  if (typeof value !== "string") throw new HttpError(400, "Write a note, or delete it instead.");
  const body = value.trim();
  if (!body) throw new HttpError(400, "Write a note, or delete it instead.");
  if (body.length > PRIVATE_NOTE_MAX_CHARS) {
    throw new HttpError(400, "Notes can be up to " + PRIVATE_NOTE_MAX_CHARS + " characters.");
  }
  // v5.54 (L1): a NUL trips the table CHECK (SQLite's length() stops at it),
  // so control characters are a 400 here. Notes are multi-line: \n and \t stay.
  if ([...body].some((ch) => ch !== "\n" && ch !== "\t" && isRefusedChar(ch.codePointAt(0)))) {
    throw new HttpError(400, "Write a note, or delete it instead.");
  }
  return body;
}

async function readNote(db, ownerId, subjectId) {
  return shapeNote(await db.prepare(NOTE_SELECT_SQL).bind(ownerId, subjectId).first());
}

async function writeNote(request, env, ownerId, subjectId) {
  const input = await readJson(request);
  const body = noteBody(input.body);
  const db = env.FORUM_DB;
  const at = nowSeconds();
  const result = await db.prepare(NOTE_UPSERT_SQL).bind(ownerId, subjectId, body, at, ownerId).run();
  if (Number(result.meta?.changes) !== 1) {
    // The cap refused the INSERT; a note that already exists still updates.
    const updated = await db.prepare(NOTE_UPDATE_SQL).bind(body, at, ownerId, subjectId).run();
    if (Number(updated.meta?.changes) !== 1) {
      throw new HttpError(400, "You can keep notes on up to " + PRIVATE_NOTES_MAX + " members.");
    }
  }
  return json({ note: await readNote(db, ownerId, subjectId) });
}

export async function handlePrivateNoteRoutes(request, env, url, path, method) {
  const match = path.match(NOTE_PATH);
  if (!match) return null;
  if (method === "GET") {
    const ownerId = Number((await requireSignedInRead(request, env)).user.id);
    const subjectId = await subjectFor(env, match[1], ownerId);
    return json({ note: await readNote(env.FORUM_DB, ownerId, subjectId) });
  }
  if (method !== "PUT" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await requireUser(request, env);
  const ownerId = Number(session.user.id);
  if (method === "PUT") await assertNotBanned(env, ownerId);
  await rateLimit(request, env, "write", String(ownerId));
  const subjectId = await subjectFor(env, match[1], ownerId);
  if (method === "PUT") return writeNote(request, env, ownerId, subjectId);
  await env.FORUM_DB.prepare(NOTE_DELETE_SQL).bind(ownerId, subjectId).run();
  return json({ note: null });
}
