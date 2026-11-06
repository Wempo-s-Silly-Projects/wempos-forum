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

function apiError(error) {
  if (error instanceof HttpError) {
    return json(error.payload || { error: error.message }, error.status, error.headers);
  }
  console.error("Forum request failed:", error);
  return json({ error: "Something went wrong. Please try again." }, 500);
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

  const handlers = [handleAuthRoutes, handlePostRoutes, handleProfileRoutes, handleModerationRoutes, handleNotificationsRoutes, handleSubscriptionsRoutes, handlePollRoutes, handleBookmarkRoutes, handleAttachmentRoutes, handleArchiveRoutes, handleGifRoutes, handleLeaderboardRoutes, handleRulesRoutes, handleAppealRoutes, handleChatRoutes, handleDmRoutes, handleWallRoutes, handleTotpRoutes, handleFilterAdminRoutes];
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
      return secureResponse(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error("Static asset request failed:", error);
      return json({ error: "The requested page could not be loaded." }, 500);
    }
  },
};