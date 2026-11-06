// Route composition and the Worker entrypoint. All handler logic lives under
// api/; worker.mjs re-exports the functions that tests import. workerd
// validates every Worker export as a function or ExportedHandler, so besides
// the default fetch only `export { ... } from` re-exports appear here.
import { HttpError, json, rateLimit, securityHeaders } from "./api/core/http.mjs";
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
import { handleChatRoutes } from "./api/chat.mjs";
import { handleWallRoutes } from "./api/wall.mjs";
import { handleDmRoutes } from "./api/dms.mjs";
import { handleBlockRoutes } from "./api/blocks.mjs";
import { handleTotpRoutes } from "./api/twofa.mjs";
import { ensureFilterWords, handleFilterAdminRoutes } from "./api/filterstore.mjs";

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
export { createUserBan } from "./api/moderation.mjs";
export { fanOutStatements, notificationBatchStatements, unreadCount } from "./api/notifications.mjs";

function secureResponse(response) {
  const headers = securityHeaders(response.headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Conditional gets (If-None-Match / If-Modified-Since) are dropped before the
// asset pipeline sees them: ASSETS.fetch answers them with a bare 304 that
// bypasses stampedAssetResponse entirely, so the browser would keep its
// pre-stamp HTML (and pre-security-header everything) until the etag changed.
// Static bytes are small here — a full 200 on revalidation is the right trade.
const CONDITIONAL_HEADERS = ["If-None-Match", "If-Modified-Since"];
function unconditional(request) {
  const headers = new Headers(request.headers);
  for (const name of CONDITIONAL_HEADERS) headers.delete(name);
  return new Request(request.url, { method: request.method, headers });
}

function apiError(error) {
  if (error instanceof HttpError) {
    return json(error.payload || { error: error.message }, error.status, error.headers);
  }
  console.error("Forum request failed:", error);
  return json({ error: "Something went wrong. Please try again." }, 500);
}

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

  await rateLimit(request, env, method === "GET" || method === "HEAD" ? "read" : "write");

  const handlers = [handleAuthRoutes, handlePostRoutes, handleProfileRoutes, handleModerationRoutes, handleNotificationsRoutes, handleSubscriptionsRoutes, handlePollRoutes, handleBookmarkRoutes, handleAttachmentRoutes, handleArchiveRoutes, handleGifRoutes, handleLeaderboardRoutes, handleRulesRoutes, handleAppealRoutes, handleChatRoutes, handleDmRoutes, handleWallRoutes, handleBlockRoutes, handleTotpRoutes, handleFilterAdminRoutes];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }

  if (path.startsWith("/api/")) throw new HttpError(404, "That API endpoint does not exist.");
  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await routeApi(request, env, ctx);
      } catch (error) {
        return apiError(error);
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