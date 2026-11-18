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

// Boost mint (T79 §2.3, docs/drafts/t79-post-boost-spec.md, shared file in
// the GooberCord tree): POST /api/boost records the forum-side boost row in
// the SHARED gc_fleet_boosts ledger (the GC-scoping-pinned table GC's
// 0029 migration created; this ledger re-creates the shape IF NOT EXISTS in
// migrations/0043). The row lands PENDING (rendered_message_id NULL) — the
// forum stamps nothing; the GC render pass owns every card byte and stamps
// the mirror back. The session member must be the post's AUTHOR — boosting
// is the author's own act (a moderator gate may ride later, not now).
// Idempotent by (forum_post_id, author_id): a replayed mint inserts 0 rows
// and answers the existing boost. The response carries the boost plus the
// mirror-card PREVIEW composed in the §2.5 byte shape — the preview is a
// convenience copy; the render truth stays GC-side (renderBoostCard, whose
// excerpt cap re-applies over whatever the forum stored, so the caps here
// keep both sides deterministic without coupling them).
import { requireUser, assertNotBanned } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { postById } from "./core/shapers.mjs";
import { canViewPost } from "./core/visibility.mjs";

export const BOOST_TITLE_CAP = 100;
export const BOOST_EXCERPT_CAP = 240;
export const BOOST_ELLIPSIS = "…";

// Mint idempotency: one boost per (post, author). The NOT EXISTS guard makes
// a replayed mint insert 0 rows; the follow-up read answers the existing row
// (the row-key SELECT mirrors the bookmarks toggle's guard-then-read idiom —
// a single statement, so a racing double-tap can never mint a second line).
export const BOOST_MINT_INSERT_SQL =
  "INSERT INTO gc_fleet_boosts (forum_post_id, author_id, thread_title, thread_excerpt, created_at) " +
    "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
    "SELECT 1 FROM gc_fleet_boosts WHERE forum_post_id = ? AND author_id = ? LIMIT 1)";

export const BOOST_FOR_AUTHOR_SQL =
  "SELECT id, thread_title, thread_excerpt, created_at, rendered_message_id " +
    "FROM gc_fleet_boosts WHERE forum_post_id = ? AND author_id = ? LIMIT 1";

// The card must survive both pipelines as plain text: flatten the post body
// to one line (every whitespace run — newlines, tabs, doubles — to a single
// space) before any cap is applied.
function flatline(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

// Title = the first BOOST_TITLE_CAP flat characters of the post body (the
// forum has no thread titles — the body's head IS the title), ellipsized
// when the body ran longer.
export function boostTitleFrom(body) {
  const flat = flatline(body);
  if (flat.length <= BOOST_TITLE_CAP) return flat;
  return flat.slice(0, BOOST_TITLE_CAP) + BOOST_ELLIPSIS;
}

// Excerpt = the body AFTER the title's first BOOST_TITLE_CAP flat characters
// (no duplicate head in the card), capped at BOOST_EXCERPT_CAP, ellipsized
// when truncated. Bodies at or under the title cap leave an empty excerpt —
// the card's excerpt line stays present, just blank.
export function boostExcerptFrom(body) {
  const flat = flatline(body);
  const rest = flat.length <= BOOST_TITLE_CAP ? "" : flat.slice(BOOST_TITLE_CAP);
  if (rest.length <= BOOST_EXCERPT_CAP) return rest;
  return rest.slice(0, BOOST_EXCERPT_CAP) + BOOST_ELLIPSIS;
}

// The §2.5 byte shape (deterministic: title line, blank, excerpt line,
// blank, provenance line with the canonical /posts/:id URL). GC's
// renderBoostCard composes the SAME shape from the SAME boost fields — the
// two suites each pin these bytes — but the forum copy is preview-only.
export function boostPreview({ threadTitle, threadExcerpt, postId }, forumOrigin, authorName) {
  return "[Forum boost] " + threadTitle + "\n\n" +
    threadExcerpt + "\n\n" +
    "Posted in the forum by " + authorName +
    " — read it at " + forumOrigin + "/posts/" + postId;
}

async function handleBoostMintRoute(request, env, url, path, method) {
  if (path !== "/api/boost") return null;
  // The method gate runs before any session work so a stray GET/PATCH is a
  // 405 with zero database reads (the bookmark/route gates' exact idiom).
  if (method !== "POST") throw new HttpError(405, "That method is not supported.");
  const db = env.FORUM_DB;
  const session = await requireUser(request, env);
  const user = session.user;
  await assertNotBanned(env, user.id);
  await rateLimit(request, env, "post-write", String(user.id));
  const body = await readJson(request);
  const postId = Number(body && body.post_id);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
  const post = await postById(env, postId, user.id);
  if (!post || !(await canViewPost(env, post, user))) throw new HttpError(404, "Post not found.");
  if (Number(post.author_id) !== Number(user.id)) {
    throw new HttpError(403, "You can only boost your own posts.");
  }
  const title = boostTitleFrom(post.body);
  const excerpt = boostExcerptFrom(post.body);
  const now = nowSeconds();
  await db.prepare(BOOST_MINT_INSERT_SQL)
    .bind(postId, user.id, title, excerpt, now, postId, user.id).run();
  const row = await db.prepare(BOOST_FOR_AUTHOR_SQL).bind(postId, user.id).first();
  const boost = {
    boostId: Number(row.id),
    postId,
    threadTitle: title,
    threadExcerpt: excerpt,
    pending: row.rendered_message_id == null,
  };
  const preview = boostPreview(boost, new URL(request.url).origin, user.username);
  return json({ ok: true, ...boost, preview });
}

export async function handleBoostRoutes(request, env, url, path, method) {
  const minted = await handleBoostMintRoute(request, env, url, path, method);
  if (minted) return minted;
  return null;
}
