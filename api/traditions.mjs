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

// Community traditions (wave 2026-11-21-14), two read-only routes over data
// the forum already holds — nothing new is stored or tracked.
//   GET /api/traditions/qotd     — today's Question of the Day: the newest
//     root from the last 24 hours whose body starts with "QOTD", plus
//     `answered` (has THIS viewer replied in it, at either level; computed
//     per request, false for guests; the response is no-store).
//   GET /api/traditions/showcase — the showcase gallery: the newest showcase
//     roots carrying an approved, unrevoked image, each with its first image
//     as the cover.
// Visibility law, enforced in SQL on both: public roots only (hidden stays
// off even for staff and the author — these are public surfaces), no author
// with an active ban (read-time), and block pairs dropped both ways for
// signed-in members (staff bypass, like every feed list).
import { attachmentRowsForView } from "./attachments.mjs";
import { readSession } from "./core/auth.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { HttpError, json } from "./core/http.mjs";
import { banFilterSql } from "./posts-feed.mjs";

export const QOTD_WINDOW_SECONDS = 24 * 60 * 60;
export const SHOWCASE_GALLERY_LIMIT = 24;
const SHOWCASE_BOARD = "showcase";
const QOTD_PREFIX_SQL = "UPPER(SUBSTR(LTRIM(p.body, ' ' || char(9) || char(10) || char(13)), 1, 4)) = 'QOTD'";
const ROUTES = new Set(["/api/traditions/qotd", "/api/traditions/showcase"]);

const isoFromSeconds = (seconds) => new Date(Number(seconds) * 1000).toISOString();

async function readViewer(request, env) {
  const session = await readSession(request, env);
  return session && session.user ? session.user : null;
}

// The shared root filter: public, author not actively banned, no block pair.
function visibleRootSql(viewer) {
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
    "AND p.created_at >= ? AND " + QOTD_PREFIX_SQL + " ORDER BY p.created_at DESC, p.id DESC LIMIT 1",
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

async function showcaseGallery(env, viewer) {
  const visible = visibleRootSql(viewer);
  const rows = (await env.FORUM_DB.prepare(
    "SELECT p.id, p.body, p.created_at, u.username FROM posts p JOIN users u ON u.id = p.author_id WHERE " +
    visible.sql + "AND p.board = ? AND EXISTS (SELECT 1 FROM attachments a WHERE a.post_id = p.id " +
    "AND a.status = 'approved' AND NOT EXISTS (SELECT 1 FROM revoked_attachment_hashes rh WHERE rh.hash = a.hash)) " +
    "ORDER BY p.id DESC LIMIT " + SHOWCASE_GALLERY_LIMIT,
  ).bind(...visible.values, SHOWCASE_BOARD).all()).results || [];
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
      image: { id: String(cover.id), version: String(cover.version) },
    }];
  });
}

export async function handleTraditionRoutes(request, env, url, path, method) {
  if (!ROUTES.has(path)) return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  const viewer = await readViewer(request, env);
  if (path === "/api/traditions/qotd") return json({ qotd: await todaysQotd(env, viewer) });
  return json({ items: await showcaseGallery(env, viewer) });
}
