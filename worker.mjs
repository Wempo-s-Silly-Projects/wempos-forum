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

// Route composition and the Worker entrypoint. All handler logic lives under
// api/; worker.mjs re-exports the functions that tests import. workerd
// validates every Worker export as a function or ExportedHandler, so besides
// the default fetch only `export { ... } from` re-exports appear here.
import { HttpError, json, rateLimit, secureResponse, unconditional } from "./api/core/http.mjs";
// Phase-2 Kitskey migration: the ONE error classifier and the dispatch chain
// come from the vendored framework (core re-exports both; the byte-pin keeps
// them identical). worker.mjs stops carrying its second copy of the mapping.
import { dispatch, errorReply } from "./api/vendor/http.mjs";
import { handleAuthRoutes } from "./api/session.mjs";
import { handlePostRoutes } from "./api/posts.mjs";
import { handleProfileRoutes } from "./api/profiles.mjs";
import { handleModerationRoutes } from "./api/moderation.mjs";
import { handleNotificationsRoutes } from "./api/notifications.mjs";
import { handleSubscriptionsRoutes } from "./api/subscriptions.mjs";
import { handlePollRoutes } from "./api/polls.mjs";
import { handleBookmarkRoutes } from "./api/bookmarks.mjs";
import { handleArchiveRoutes } from "./api/archive.mjs";
import { handleGifRoutes } from "./api/gifs.mjs";
import { handleLeaderboardRoutes } from "./api/leaderboard.mjs";
import { handleRulesRoutes } from "./api/rules.mjs";
import { handleAttachmentRoutes } from "./api/attachments.mjs";
import { handleAppealRoutes } from "./api/appeals.mjs";
import { handleWallRoutes } from "./api/wall.mjs";
import { handleModLogRoutes } from "./api/modlogs.mjs";
import { handleBlockRoutes } from "./api/blocks.mjs";
import { handleTotpRoutes } from "./api/twofa.mjs";
import { handleAccountsRoutes } from "./api/accounts.mjs";
import { ensureFilterWords, handleFilterAdminRoutes } from "./api/filterstore.mjs";
import { handleRelayRoutes, relayWorkerStamp } from "./api/relay.mjs";

export { canViewPost } from "./api/core/visibility.mjs";
export { isValidUsername } from "./api/core/shapers.mjs";
export { createSession } from "./api/core/auth.mjs";
export {
  hashPassword,
  isValidPassword,
  isValidPasswordPepper,
  isValidSetupSecret,
  verifyPassword,
} from "./api/core/passwords.mjs";
export {
  createAvatarVersion,
  imageResponse,
  sanitizeImage,
  sniffImageMime,
  blobToUint8Array,
} from "./api/core/images.mjs";
export { requireTurnstile, rateLimit } from "./api/core/http.mjs";
export { relayWorkerStamp } from "./api/relay.mjs";
export { createUserBan } from "./api/moderation.mjs";
export { fanOutStatements, notificationBatchStatements, unreadCount } from "./api/notifications.mjs";

// Phase-4 Kitskey migration: the static leg's two workers — secureResponse
// (the security-header re-wrap; the framework default set is already the
// forum's byte-identical set, so core binds no config override) and
// unconditional (the conditional-get force-200 trade for documents) — now
// come from the core leaf, which is the vendored framework verbatim.
// worker.mjs stops carrying its own copies; stampedAssetResponse (the build
// stamp) STAYS app-side — the build-meta injection is this app's document,
// not a framework concern.

// The API chain's not-found tail (phase-2 migration): the vendor dispatch
// calls it when no handler matched — the two 404 copies this worker has
// always carried, still THROWN so they classify through the one errorReply
// chain instead of growing a rival response shape.
function notFound(request, env, url, path) {
  if (path.startsWith("/api/")) throw new HttpError(404, "That API endpoint does not exist.");
  throw new HttpError(404, "Not found.");
}

// The API handler chain (phase-2 migration): each handler receives the shared
// dispatch context and answers only the paths it owns; `undefined` falls
// through to the next handler or the notFound tail — the vendor's dispatch()
// replaces the inlined handlers-for-loop, built once from the vendor import.
const API_HANDLERS = [handleAuthRoutes, handlePostRoutes, handleProfileRoutes, handleModerationRoutes, handleNotificationsRoutes, handleSubscriptionsRoutes, handlePollRoutes, handleBookmarkRoutes, handleAttachmentRoutes, handleArchiveRoutes, handleGifRoutes, handleLeaderboardRoutes, handleRulesRoutes, handleAppealRoutes, handleWallRoutes, handleModLogRoutes, handleBlockRoutes, handleTotpRoutes, handleAccountsRoutes, handleFilterAdminRoutes, handleRelayRoutes];
const answerApiRoute = dispatch(API_HANDLERS, notFound);

// Stale-build stamp (v4.3.1): every HTML document the worker serves carries
// the build it came with (VERSION@COMMIT_SHA) as a <meta> tag. The client
// compares that stamp against the live /api/version — an SPA tab keeps the
// JS it was served with across deploys, and old JS talking to the newer
// backend is where the "page doesn't update after an action" class of
// misbehavior comes from; a mismatch offers the reload instead.
async function stampedAssetResponse(assetResponse, env) {
  const build = env.VERSION ? [env.VERSION, env.COMMIT_SHA].filter(Boolean).join("@") : "";
  const type = assetResponse.headers.get("Content-Type") || "";
  if (!build || !type.includes("text/html")) return assetResponse;
  const html = await assetResponse.text();
  // The served bytes change length, so the original Content-Length must go —
  // a stale length would truncate the stamped document. HTML also revalidates
  // by ETag, which only tracks the asset bytes: a deploy that bumps VERSION
  // without touching index.html would otherwise keep answering 304s with the
  // browser's OLD stamp. The shell is one small file — no-store keeps every
  // document load freshly stamped.
  const headers = new Headers(assetResponse.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  // The byte length changed, so a validator for the old body no longer
  // describes these bytes — a retained Last-Modified would advertise a lie.
  headers.delete("Last-Modified");
  headers.set("Cache-Control", "no-store");
  const stamp = `<meta name="app-build" content="${build}">`;
  return new Response(html.includes("</head>") ? html.replace("</head>", stamp + "</head>") : html, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}

// ctx carries waitUntil (v3.1): background work rides it where a route needs
// one; the response returns without waiting. Callers without a ctx (tests)
// simply never schedule background checks.
async function routeApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (!env.FORUM_DB) throw new HttpError(503, "The forum database is not configured.");

  // Filter store (v4.3): prime the word-filter list cache once per request —
  // the D1 row when it exists, else the FILTERED_WORDS secret.
  await ensureFilterWords(env);

  // The global tier. Relay-lane calls (the sibling workers' service-binding
  // lanes under /api/relay/*) carry no browser IP, and every one collapsed
  // into the same "unknown" bucket — GC's and Accounts' credential work
  // throttling each other estate-wide (the H2 finding). When a token-holding
  // caller announces itself with the plain X-Relay-Worker slug, the tier
  // keys on THAT instead (current behavior otherwise). The slug is a
  // bucketing convenience, NOT an auth boundary: the X-Relay-Token validated
  // inside the relay handlers is the only boundary, and this pre-auth read
  // only ever picks a throttle key. Whether the platform injects
  // CF-Connecting-IP into service-binding subrequests is unverified — the
  // explicit slug makes us platform-independent either way.
  const relayWorker = relayWorkerStamp(request);
  if (relayWorker) {
    await rateLimit(request, env, method === "GET" || method === "HEAD" ? "read" : "write", "worker:" + relayWorker);
  } else {
    await rateLimit(request, env, method === "GET" || method === "HEAD" ? "read" : "write");
  }

  return answerApiRoute(request, env, url, path, method, ctx);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await routeApi(request, env, ctx);
      } catch (error) {
        // The error classifier is the vendor's errorReply (imported above);
        // the console label keeps the pair's literal, byte-for-byte.
        return errorReply(error, "Forum request failed:");
      }
    }
    if (!env.ASSETS) return json({ error: "Static assets are not configured." }, 503);
    try {
      return secureResponse(await stampedAssetResponse(await env.ASSETS.fetch(unconditional(request)), env));
    } catch (error) {
      console.error("Static asset request failed:", error);
      return json({ error: "The requested page could not be loaded." }, 500);
    }
  },
};
