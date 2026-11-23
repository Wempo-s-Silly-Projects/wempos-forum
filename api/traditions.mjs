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

// Community traditions (wave 2026-11-21-14), two read-only routes over data
// the forum already holds — nothing new is stored or tracked.
//   GET /api/traditions/qotd     — today's Question of the Day: the newest
//     root from the last 24 hours whose body starts with "QOTD", plus
//     `answered` (has THIS viewer replied in it, at either level; computed
//     per request, false for guests; the response is no-store).
//   GET /api/traditions/showcase — the showcase gallery: the newest showcase
//     roots carrying an approved, unrevoked image, each with its first image
//     as the cover, plus `staffPick` (v5.35): the current staff pick of the
//     week, pinned on top by the client — null when there is none or the
//     viewer may not see it.
// Visibility law, enforced in SQL on both: public roots only (hidden stays
// off even for staff and the author — these are public surfaces), no author
// with an active ban (read-time), and block pairs dropped both ways for
// signed-in members (staff bypass, like every feed list).
import { attachmentRowsForView } from "./attachments.mjs";
import { readSession } from "./core/auth.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { HttpError, json } from "./core/http.mjs";
import { banFilterSql } from "./posts-feed.mjs";
import { maskedExcerpt } from "./core/spoilers.mjs";
import { ROLE_ADMIN_DB, ROLE_OWNER_DB } from "./core/roles.mjs";

export const QOTD_WINDOW_SECONDS = 24 * 60 * 60;
export const SHOWCASE_GALLERY_LIMIT = 24;
export const SHOWCASE_BOARD = "showcase";
// Server-side previews (v5.35: the staff pick, /week threads): spoilers are
// masked BEFORE the cut, whitespace flattened.
export const PREVIEW_EXCERPT_MAX = 200;
const QOTD_PREFIX_SQL = "UPPER(SUBSTR(LTRIM(p.body, ' ' || char(9) || char(10) || char(13)), 1, 4)) = 'QOTD'";
// QOTD is the owner's and admins' job (owner, Nov 21): only a root written by
// the owner (stored ROLE_OWNER_DB) or a site admin (stored ROLE_ADMIN_DB)
// becomes today's question. Built from constants only — no input reaches it.
const QOTD_STAFF_AUTHOR_SQL =
  "p.author_id IN (SELECT id FROM users WHERE role IN ('" + ROLE_OWNER_DB + "', '" + ROLE_ADMIN_DB + "'))";
const ROUTES = new Set(["/api/traditions/qotd", "/api/traditions/showcase"]);

const isoFromSeconds = (seconds) => new Date(Number(seconds) * 1000).toISOString();
export const previewExcerpt = (body) => maskedExcerpt(String(body ?? ""), PREVIEW_EXCERPT_MAX).replace(/\s+/g, " ").trim();

export async function readViewer(request, env) {
  const session = await readSession(request, env);
  return session && session.user ? session.user : null;
}

// The shared root filter: public, author not actively banned, no block pair.
// Exported (v5.35) for the This-week page's thread list.
export function visibleRootSql(viewer) {
  const blockClause = viewerBlockFilterSql(viewer, "p.author_id");
  return {
    sql: "p.parent_id IS NULL AND p.visibility = 'public' AND " + banFilterSql("p") + blockClause + " ",
    values: blockClause ? [viewer.id, viewer.id] : [],
  };
}

async function viewerAnswered(env, viewer, rootId) {
  if (!viewer) return false;
  const row = await env.FORUM_DB.prepare(
    "SELECT 1 AS hit FROM posts r WHERE r.author_id = ? AND (r.parent_id = ? OR r.parent_id IN " +
    "(SELECT l1.id FROM posts l1 WHERE l1.parent_id = ?)) LIMIT 1",
  ).bind(viewer.id, rootId, rootId).first();
  return Boolean(row);
}

async function todaysQotd(env, viewer) {
  const visible = visibleRootSql(viewer);
  const since = Math.floor(Date.now() / 1000) - QOTD_WINDOW_SECONDS;
  const row = await env.FORUM_DB.prepare(
    "SELECT p.id, p.body, p.board, p.created_at FROM posts p WHERE " + visible.sql +
    "AND p.created_at >= ? AND " + QOTD_PREFIX_SQL + " AND " + QOTD_STAFF_AUTHOR_SQL + " ORDER BY p.created_at DESC, p.id DESC LIMIT 1",
  ).bind(...visible.values, since).first();
  if (!row) return null;
  return {
    id: Number(row.id),
    body: String(row.body ?? ""),
    board: row.board || "general",
    createdAt: isoFromSeconds(row.created_at),
    answered: await viewerAnswered(env, viewer, Number(row.id)),
  };
}

// `since` (v5.35, epoch seconds): the This-week page keeps only builds
// created at or after it; the gallery itself passes nothing (no window).
export async function showcaseGallery(env, viewer, { since = null } = {}) {
  const visible = visibleRootSql(viewer);
  const sinceSql = since === null ? "" : "AND p.created_at >= ? ";
  const rows = (await env.FORUM_DB.prepare(
    "SELECT p.id, p.body, p.created_at, u.username FROM posts p JOIN users u ON u.id = p.author_id WHERE " +
    visible.sql + "AND p.board = ? " + sinceSql + "AND EXISTS (SELECT 1 FROM attachments a WHERE a.post_id = p.id " +
    "AND a.status = 'approved' AND NOT EXISTS (SELECT 1 FROM revoked_attachment_hashes rh WHERE rh.hash = a.hash)) " +
    "ORDER BY p.id DESC LIMIT " + SHOWCASE_GALLERY_LIMIT,
  ).bind(...visible.values, SHOWCASE_BOARD, ...(since === null ? [] : [since])).all()).results || [];
  if (!rows.length) return [];
  // Anonymous view: approved rows only, with the shared revocation and
  // byte-existence filters — a tile never points at an image that 404s.
  const images = await attachmentRowsForView(env.FORUM_DB, rows.map((row) => Number(row.id)), null);
  return rows.flatMap((row) => {
    const cover = (images.get(Number(row.id)) || []).find((image) => image.status === "approved");
    if (!cover) return [];
    return [{
      id: Number(row.id),
      body: String(row.body ?? ""),
      authorName: String(row.username ?? ""),
      createdAt: isoFromSeconds(row.created_at),
      image: { id: String(cover.id), version: String(cover.version), mime: String(cover.mime ?? "") },
    }];
  });
}

// Staff pick of the week (v5.35, migration 0065): the NEWEST featured_posts
// row, shown only while its post still passes the public-root filter for
// THIS viewer (public, showcase, author not actively banned, no block pair —
// hidden stays off even for staff: this is the public face). A pick that
// fails simply doesn't show; an older pick never stands in for it.
export async function currentStaffPick(env, viewer) {
  const newest = await env.FORUM_DB.prepare(
    "SELECT f.post_id FROM featured_posts f ORDER BY f.picked_at DESC, f.id DESC LIMIT 1",
  ).first();
  if (!newest) return null;
  const visible = visibleRootSql(viewer);
  const row = await env.FORUM_DB.prepare(
    "SELECT p.id, p.body, p.created_at, u.username FROM posts p JOIN users u ON u.id = p.author_id WHERE " +
    visible.sql + "AND p.id = ? AND p.board = ? LIMIT 1",
  ).bind(...visible.values, Number(newest.post_id), SHOWCASE_BOARD).first();
  if (!row) return null;
  const images = await attachmentRowsForView(env.FORUM_DB, [Number(row.id)], null);
  const cover = (images.get(Number(row.id)) || []).find((image) => image.status === "approved");
  return {
    id: Number(row.id),
    excerpt: previewExcerpt(row.body),
    authorName: String(row.username ?? ""),
    createdAt: isoFromSeconds(row.created_at),
    image: cover ? { id: String(cover.id), version: String(cover.version), mime: String(cover.mime ?? "") } : null,
  };
}

export async function handleTraditionRoutes(request, env, url, path, method) {
  if (!ROUTES.has(path)) return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  const viewer = await readViewer(request, env);
  if (path === "/api/traditions/qotd") return json({ qotd: await todaysQotd(env, viewer) });
  return json({ items: await showcaseGallery(env, viewer), staffPick: await currentStaffPick(env, viewer) });
}
