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

// Download my data (v4.23): GET /api/me/export hands the signed-in member a
// JSON file of what THEY wrote and set here — nothing more. Every query is
// keyed on the caller's own id and selects an explicit column list (never
// SELECT *), so credential columns (password hash/salt, TOTP secrets, backup
// code hashes), session tokens, CSRF tokens, IP data, avatar bytes and
// idempotency keys can never ride along.
//
// Scope decisions:
// - Own posts/replies are exported as written (spoilers unmasked, hidden
//   ones included): the text is the author's, so the excerpt masking law for
//   previews does not apply to a member reading back their own words.
// - Bookmarks and followed threads carry post ids only — never the other
//   member's text — so the visibility law has nothing to filter here.
// - Blocks carry only the caller's OWN direction; who blocked the caller is
//   the other member's record.
// - Private notes (v5.47): only notes the caller WROTE (subject username,
//   body, time). Notes other members keep about the caller are theirs.
// - Saved searches (v5.48): the caller's OWN saved searches (name, q, by,
//   in, time), owner-keyed.
// - Thread TL;DRs (v5.50): only summaries the caller WROTE (post id, body,
//   time) — on their own threads or, for staff, on others'. A summary staff
//   wrote on the caller's thread is the writer's record.
// - Direct messages: only messages the caller AUTHORED (1:1 and group), with
//   the conversation's other username / group name for context. Replies
//   written by others belong to them and stay out.
import { requireSignedInRead } from "./core/auth.mjs";
import { json, rateLimit } from "./core/http.mjs";
import { socialsFromRow, SOCIAL_PLATFORMS } from "./core/shapers.mjs";
import { normalizeTotpAlgorithm } from "./core/totp.mjs";
import { readPronouns } from "./pronouns.mjs";
import { EXPORT_SECTION_CAPS } from "../constants.mjs";

const EXPORT_FORMAT = "wempos-forum-export";
const EXPORT_FORMAT_VERSION = 1;

const isoOrNull = (seconds) =>
  seconds === null || seconds === undefined ? null : new Date(Number(seconds) * 1000).toISOString();

const PROFILE_COLUMNS = [
  "id", "username", "role", "bio", "profile_accent", "banner_color", "banner_text", "flair",
  "approved_css", "pending_css", "css_status", "polytoria_username", "avatar_status",
  "created_at", "totp_enabled", ...SOCIAL_PLATFORMS.map((platform) => platform.column),
].join(", ");

async function rowsCapped(db, sql, binds, cap) {
  const rows = (await db.prepare(sql + " LIMIT ?").bind(...binds, cap + 1).all()).results || [];
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

async function readProfile(db, userId) {
  const row = await db.prepare(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ? LIMIT 1`).bind(userId).first();
  const presence = await db.prepare("SELECT invisible FROM presence WHERE user_id = ? LIMIT 1").bind(userId).first();
  // v5.20.0: the 2FA algorithm name only (never the secret); no row = SHA1.
  const totpAlgorithm = await db.prepare("SELECT algorithm FROM totp_algorithms WHERE user_id = ? LIMIT 1")
    .bind(userId).first();
  const twoFactorEnabled = Boolean(Number(row.totp_enabled));
  const profile = {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    bio: row.bio,
    flair: row.flair,
    profileAccent: row.profile_accent,
    bannerColor: row.banner_color,
    bannerText: row.banner_text,
    approvedCss: row.approved_css,
    pendingCss: row.pending_css,
    cssStatus: row.css_status,
    polytoriaUsername: row.polytoria_username,
    avatarStatus: row.avatar_status,
    socials: socialsFromRow(row),
    // v5.23.0: opt-in pronouns; null when the member never set any.
    pronouns: (await readPronouns(db, userId)) || null,
    joinedAt: isoOrNull(row.created_at),
  };
  const settings = {
    twoFactorEnabled,
    twoFactorAlgorithm: twoFactorEnabled ? normalizeTotpAlgorithm(totpAlgorithm?.algorithm) : null,
    invisibleOnline: Boolean(Number(presence?.invisible)),
  };
  return { profile, settings };
}

const SECTION_READERS = {
  posts: (db, id, cap) => rowsCapped(db,
    "SELECT id, parent_id, board, body, visibility, created_at, edited_at FROM posts " +
    "WHERE author_id = ? ORDER BY id DESC", [id], cap),
  bookmarks: (db, id, cap) => rowsCapped(db,
    "SELECT post_id, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC, post_id DESC", [id], cap),
  followedThreads: (db, id, cap) => rowsCapped(db,
    "SELECT post_id, created_at FROM thread_subscriptions WHERE user_id = ? " +
    "ORDER BY created_at DESC, post_id DESC", [id], cap),
  blocks: (db, id, cap) => rowsCapped(db,
    "SELECT u.id, u.username, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id " +
    "WHERE b.blocker_id = ? ORDER BY b.created_at DESC, u.id DESC", [id], cap),
  wallPosts: (db, id, cap) => rowsCapped(db,
    "SELECT w.id, w.body, w.created_at, u.username AS wall_owner FROM wall_posts w " +
    "LEFT JOIN users u ON u.id = w.owner_id WHERE w.author_id = ? ORDER BY w.id DESC", [id], cap),
  directMessages: readAuthoredMessages,
  // v5.44: the caller's OWN reactions on 1:1 DM messages — message ids and
  // values only, never the other participant's text.
  dmReactions: (db, id, cap) => rowsCapped(db,
    "SELECT message_id, emoji, created_at FROM dm_message_reactions WHERE user_id = ? " +
    "ORDER BY created_at DESC, message_id DESC", [id], cap),
  // v5.47: the caller's OWN private notes (migration 0072), owner-keyed.
  privateNotes: (db, id, cap) => rowsCapped(db,
    "SELECT u.username AS subject, n.body, n.updated_at FROM private_notes n JOIN users u ON u.id = n.subject_id " +
    "WHERE n.owner_id = ? ORDER BY n.updated_at DESC, n.subject_id DESC", [id], cap),
  // v5.48: the caller's OWN saved searches (migration 0073), owner-keyed.
  savedSearches: (db, id, cap) => rowsCapped(db,
    "SELECT name, q, by_username, in_scope, created_at FROM saved_searches WHERE owner_id = ? " +
    "ORDER BY created_at DESC, id DESC", [id], cap),
  // v5.50: TL;DR summaries the caller WROTE (migration 0074), writer-keyed.
  threadSummaries: (db, id, cap) => rowsCapped(db,
    "SELECT post_id, body, updated_at FROM thread_summaries WHERE updated_by = ? " +
    "ORDER BY updated_at DESC, post_id DESC", [id], cap),
  // Batch K: post images the caller UPLOADED (ids + mime only, never bytes;
  // the client fetches each through the normal attachment route into the
  // ZIP). Marketplace GIF picks are someone else's image and stay out.
  uploads: (db, id, cap) => rowsCapped(db,
    "SELECT id, post_id, status, mime, created_at FROM attachments " +
    "WHERE created_by = ? AND source_kind <> 'gif' AND status <> 'rejected' " +
    "ORDER BY created_at DESC, id DESC", [id], cap),
};

// Both DM stores, caller-authored rows only, merged newest first under one cap.
async function readAuthoredMessages(db, id, cap) {
  const direct = await rowsCapped(db,
    "SELECT m.id, m.body, m.created_at, u.username AS with_username FROM dm_messages m " +
    "JOIN dm_threads t ON t.id = m.thread_id " +
    "LEFT JOIN users u ON u.id = CASE WHEN t.user_a = ? THEN t.user_b ELSE t.user_a END " +
    "WHERE m.user_id = ? ORDER BY m.id DESC", [id, id], cap);
  const group = await rowsCapped(db,
    "SELECT m.id, m.body, m.created_at, g.name AS group_name FROM dm_group_messages m " +
    "LEFT JOIN dm_groups g ON g.id = m.group_id WHERE m.user_id = ? ORDER BY m.id DESC", [id], cap);
  const merged = [
    ...direct.rows.map((row) => ({ ...row, kind: "direct" })),
    ...group.rows.map((row) => ({ ...row, kind: "group" })),
  ].sort((a, b) => Number(b.created_at) - Number(a.created_at));
  return {
    rows: merged.slice(0, cap),
    truncated: direct.truncated || group.truncated || merged.length > cap,
  };
}

const SECTION_SHAPERS = {
  posts: (row) => ({
    id: Number(row.id),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    board: row.board,
    visibility: row.visibility,
    body: row.body,
    createdAt: isoOrNull(row.created_at),
    editedAt: isoOrNull(row.edited_at),
  }),
  bookmarks: (row) => ({ postId: Number(row.post_id), savedAt: isoOrNull(row.created_at) }),
  followedThreads: (row) => ({ postId: Number(row.post_id), followedAt: isoOrNull(row.created_at) }),
  blocks: (row) => ({ id: Number(row.id), username: row.username, blockedAt: isoOrNull(row.created_at) }),
  wallPosts: (row) => ({
    id: Number(row.id), wallOwner: row.wall_owner ?? null, body: row.body, createdAt: isoOrNull(row.created_at),
  }),
  directMessages: (row) => ({
    kind: row.kind,
    id: Number(row.id),
    with: row.kind === "direct" ? row.with_username ?? null : null,
    groupName: row.kind === "group" ? row.group_name ?? null : null,
    body: row.body,
    sentAt: isoOrNull(row.created_at),
  }),
  dmReactions: (row) => ({ messageId: Number(row.message_id), value: row.emoji, reactedAt: isoOrNull(row.created_at) }),
  privateNotes: (row) => ({ subject: row.subject, body: row.body, updatedAt: isoOrNull(row.updated_at) }),
  savedSearches: (row) => ({
    name: row.name, q: row.q, by: row.by_username ?? null, in: row.in_scope ?? null, createdAt: isoOrNull(row.created_at),
  }),
  threadSummaries: (row) => ({ postId: Number(row.post_id), body: row.body, updatedAt: isoOrNull(row.updated_at) }),
  uploads: (row) => ({
    id: row.id, postId: Number(row.post_id), status: row.status, mime: row.mime, uploadedAt: isoOrNull(row.created_at),
  }),
};

export async function buildExport(env, userId) {
  const db = env.FORUM_DB;
  const { profile, settings } = await readProfile(db, userId);
  const sections = {};
  const truncated = {};
  for (const [name, cap] of Object.entries(EXPORT_SECTION_CAPS)) {
    const result = await SECTION_READERS[name](db, userId, cap);
    sections[name] = result.rows.map(SECTION_SHAPERS[name]);
    truncated[name] = result.truncated;
  }
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    caps: EXPORT_SECTION_CAPS,
    truncated,
    profile,
    settings,
    ...sections,
  };
}

export async function handleExportRoutes(request, env, url, path, method) {
  if (path !== "/api/me/export" || method !== "GET") return null;
  const { user } = await requireSignedInRead(request, env);
  // Heavy read: the shared write tier, keyed per member (not per network).
  await rateLimit(request, env, "write", String(user.id));
  const data = await buildExport(env, Number(user.id));
  // json() already stamps Cache-Control: no-store. The filename carries the
  // numeric id only, so no member-chosen text reaches a response header.
  return json(data, 200, {
    "Content-Disposition": `attachment; filename="wempos-forum-data-${Number(user.id)}.json"`,
  });
}
