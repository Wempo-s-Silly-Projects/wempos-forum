// Project Designer — experience/http
// The response/error/dispatch vocabulary, extracted from wempos-forum's
// api/core/http.mjs + worker.mjs's api chain (GooberCord carries the same
// vocabulary in its own api/core — the two were twins first).
//
// THE HOUSE RULES this module enforces by construction:
//   - EVERY response rides the security header set: json() applies it to the
//     API surface, and the static leg's secureResponse (on makeHttp, with the
//     app's securityHeaders riding config) applies it to the asset surface —
//     the apps' worker.mjs carried byte-identical secureResponse/unconditional
//     twins, which is now this module (static-leg deliverable).
//   - errors are thrown, never returned: the route handlers raise HttpError
//     and ONE classifier (errorReply) turns the whole API's possible
//     failures into the single response shape — { error: message }, the
//     payload passthrough when a route needs a richer body (the ban screen),
//     and the ONE shared 500 that never echoes internals ("Forum request
//     failed:" was the forum's console label; apps pass their own label).
//   - the shared 403/401/410/429 lives in the route module that owns it —
//     this module only guarantees the classification plumbing, so no route
//     can grow its own rival error shape.
//   - rate limits key through a SHA-256 of scope:actor (actor when given,
//     else the connecting IP), resolved through the app's binding-name map;
//     a missing limiter is a hard 503, never a silently unlimited route.
//
// No dependencies, no build step. The D1/database surface is NOT here —
// experience/db owns it (deliverable 4).

export class HttpError extends Error {
  // `payload` replaces the JSON body when present (the ban-screen login
  // response, which carries reason/expiresAt beyond the error message).
  constructor(status, message, headers = {}, payload = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.headers = headers;
    this.payload = payload;
  }
}

export const MAX_JSON_BYTES = 16 * 1024;
const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

// sha256Hex: the same identity-hashing the apps' crypto leaf performs
// (crypto.subtle digest, hex-encoded). Rate-limiter keys arrive normalized;
// WebCrypto is global in Workers and Node 18+, so no dependency is needed.
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function securityHeaders(headers = new Headers()) {
  const result = new Headers(headers);
  result.set("X-Content-Type-Options", "nosniff");
  result.set("Strict-Transport-Security", "max-age=31536000");
  result.set("X-Frame-Options", "DENY");
  result.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  result.set("Cross-Origin-Resource-Policy", "same-origin");
  result.set("Cross-Origin-Opener-Policy", "same-origin");
  result.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; " +
    "img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; " +
    "frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'none'",
  );
  return result;
}

export function json(data, status = 200, headers = {}) {
  const resultHeaders = securityHeaders(new Headers(headers));
  resultHeaders.set("Content-Type", "application/json; charset=utf-8");
  resultHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: resultHeaders });
}

// The ONE error classifier: HttpErrors ride their own status/shape (payload
// passthrough included); anything else is console-logged with the app's label
// and answers the single shared 500. Extraction note: the original inlined
// this in worker.mjs (apiError); the framework makes it named and shared.
export function errorReply(error, consoleLabel = "Request failed:") {
  if (error instanceof HttpError) {
    return json(error.payload || { error: error.message }, error.status, error.headers);
  }
  console.error(consoleLabel, error);
  return json({ error: "Something went wrong. Please try again." }, 500);
}

// The ONE dispatch chain: a route file exports handler(request, env, url,
// path, method, ctx); the first truthy response wins; nobody matched falls
// to the app's 404 copy. (Original: the handlers-for-loop in worker.mjs's
// routeApi — the array-of-handlers shape is kept EXACTLY so migrating a
// route file is a one-line import swap, never a rewrite.)
export function dispatch(handlers, after = null) {
  return async (request, env, url, path, method, ctx) => {
    for (const handler of handlers) {
      const response = await handler(request, env, url, path, method, ctx);
      if (response) return response;
    }
    if (after) return after(request, env, url, path, method, ctx);
    throw new HttpError(404, "Not found.");
  };
}

// --- the static leg -----------------------------------------------------------

// Conditional gets (If-None-Match / If-Modified-Since) are dropped before the
// asset pipeline sees them — but only for DOCUMENT requests: ASSETS.fetch
// answers them with a bare 304 that bypasses the app-side stamping entirely,
// so the browser would keep its pre-stamp, pre-security-header HTML until the
// etag changed. Only HTML documents get stamped, so only document requests
// need the force-200 trade; every other asset (JS/CSS/images) keeps its
// correct 304 revalidation path instead of a full 200 per visit. (The two
// apps carried this block byte-identical in their worker.mjs; the extraction
// keeps the names — unconditional, isDocumentRequest — so migrating a worker
// is an import swap, never a rewrite.)
const CONDITIONAL_HEADERS = ["If-None-Match", "If-Modified-Since"];
const DOCUMENT_SECFETCH_DESTS = new Set(["document", "iframe", "frame"]);

export function isDocumentRequest(request) {
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (dest) return DOCUMENT_SECFETCH_DESTS.has(dest.toLowerCase());
  // Fallback without sec-fetch-dest (older agents, wrangler dev): an
  // extension-less path (SPA routes, "/") or .html is a document.
  const path = new URL(request.url).pathname;
  if (/\.html?$/i.test(path)) return true;
  const last = path.split("/").pop();
  return last === "" || !last.includes(".");
}

export function unconditional(request) {
  if (!isDocumentRequest(request)) return request;
  const headers = new Headers(request.headers);
  for (const name of CONDITIONAL_HEADERS) headers.delete(name);
  // The rebuilt request spells URL + method explicitly (the forum twin's
  // shape; GooberCord rebuilt by Request-copy instead). Behaviorally
  // identical for the GET document requests this leg serves — the explicit
  // spelling wins because it does not depend on the original request's
  // internals surviving a copy.
  return new Request(request.url, { method: request.method, headers });
}

// makeHttp: the config-bound half. Each app passes its limiter binding map
// ({ [scope]: bindingName }), its JSON cap, and — for the static leg — the
// securityHeaders function its surface answers with. A limiter map without
// the scope fails the route (503) instead of silently skipping the wall.
export function makeHttp({
  rateLimitBindings = {},
  maxJsonBytes = MAX_JSON_BYTES,
  securityHeaders: appSecurityHeaders = securityHeaders,
} = {}) {
  async function rateLimit(request, env, scope, actor = "") {
    const bindingName = rateLimitBindings[scope];
    const limiter = bindingName ? env[bindingName] : null;
    if (!limiter || typeof limiter.limit !== "function") {
      throw new HttpError(503, "Rate limiting is not configured for this endpoint.");
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const identity = actor ? scope + ":" + actor : scope + ":" + ip;
    const key = await sha256Hex(identity);
    const { success } = await limiter.limit({ key });
    if (!success) {
      throw new HttpError(429, "Too many requests. Please wait a little and try again.", {
        "Retry-After": "60",
      });
    }
  }

  // requireMutationApplied: the guarded-WRITE pin — an INSERT/UPDATE/DELETE
  // the row guard refused (changes === 0) answers the shared 403, exactly
  // like the original: the route's WHERE clause carries the session's ban
  // gate, so a refused mutation IS "currently banned" from the caller's
  // point of view. The message stays the pair's literal.
  function requireMutationApplied(result) {
    if (Number(result?.meta?.changes) !== 1) {
      throw new HttpError(403, "This account is currently banned.");
    }
    return result;
  }

  async function readLimitedBody(request, maximum) {
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > maximum) throw new HttpError(413, "That upload is too large.");
    const reader = request.body && request.body.getReader ? request.body.getReader() : null;
    if (!reader) return new Uint8Array();
    const chunks = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximum) {
        try {
          await reader.cancel();
        } catch (cancelError) {
          console.warn(
            "Request body cancellation failed:",
            cancelError && cancelError.name ? cancelError.name : "UnknownError",
          );
        }
        throw new HttpError(413, "That upload is too large.");
      }
      chunks.push(part.value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  async function readJson(request, bytesOverride = maxJsonBytes) {
    const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      throw new HttpError(415, "Send this form as JSON.");
    }
    const bytes = await readLimitedBody(request, bytesOverride);
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new HttpError(400, "The request body is not valid JSON.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new HttpError(400, "The request body must be a JSON object.");
    }
    return value;
  }

  function requiredText(value, field, maximum) {
    if (typeof value !== "string") throw new HttpError(400, "Enter a valid " + field + ".");
    const result = value.trim();
    if (!result || result.length > maximum) {
      throw new HttpError(400, field.charAt(0).toUpperCase() + field.slice(1) + " must be between 1 and " + maximum + " characters.");
    }
    return result;
  }

  // The static leg: an upstream (ASSETS) response re-wrapped with the security
  // header set the app chose on config. Body, status, and statusText pass
  // through untouched; the header set is the only thing the leg decides. The
  // framework default serves the framework's own set; a divergent app (a
  // voice policy, say) passes ITS securityHeaders and every static response
  // rides that one instead — the same re-assertion point the apps' inline
  // secureResponse used. (The build-stamping that often surrounds this call
  // stays app-side: it differs per app — build-meta injection is an app's
  // document, not a framework concern.)
  function secureResponse(response) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: appSecurityHeaders(response.headers),
    });
  }

  return {
    rateLimit,
    requireMutationApplied,
    readLimitedBody,
    readJson,
    requiredText,
    secureResponse,
  };
}

// requireTurnstile stays an app-side concern for now: it fetches siteverify
// with the app's secret/hostnames and the shared fail-closed refusals — the
// extraction lands with experience/auth (deliverable 5), which owns every
// credential-adjacent call, so the verification wall ships in one piece.
// Deliberate: half a Turnstile here is worse than the whole one there.
