// v4.0 core leaf: request/response glue — the typed error, JSON responses,
// the security-header set, rate limiting, Turnstile verification, bounded
// body reading, and field validation.
//
// Phase-1 Kitskey migration: the error/response/rate-limit vocabulary now
// LIVES in api/vendor/http.mjs (byte-identical to the framework's
// experience/http.mjs — pinned by tests/vendor-parity.test.mjs; the file is
// the framework's, not an app-owned copy). This leaf re-exports that surface
// unchanged so every api module imports exactly the way it did — public
// signatures and messages never moved — and keeps the app-side pieces: the
// Turnstile wall (app secret/hostnames) and the forum's limiter binding map.
import { RATE_LIMIT_BINDINGS, TURNSTILE_SITEVERIFY_URL } from "../../constants.mjs";
import {
  HttpError,
  MAX_JSON_BYTES,
  errorReply,
  json as vendorJson,
  makeHttp,
  securityHeaders as vendorSecurityHeaders,
} from "../vendor/http.mjs";

// The vendored surface, unchanged; errorReply arrives for the phase-2
// worker.mjs migration (worker.mjs still carries its inline apiError twin).
export { HttpError, MAX_JSON_BYTES, errorReply };
export const securityHeaders = vendorSecurityHeaders;
export const json = vendorJson;

// The config-bound half: the forum's limiter map and the shared JSON cap.
const app = makeHttp({ rateLimitBindings: RATE_LIMIT_BINDINGS, maxJsonBytes: MAX_JSON_BYTES });
export const rateLimit = app.rateLimit;
export const requireMutationApplied = app.requireMutationApplied;
export const readLimitedBody = app.readLimitedBody;
export const readJson = app.readJson;
export const requiredText = app.requiredText;

const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

export async function requireTurnstile(request, env, body, expectedAction) {
  const secret = env.TURNSTILE_SECRET;
  const hostnames = String(env.TURNSTILE_HOSTNAMES || "")
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  const token = typeof body["cf-turnstile-response"] === "string" ? body["cf-turnstile-response"] : "";
  if (!secret || hostnames.length === 0 || !token || token.length > TURNSTILE_TOKEN_MAX_LENGTH) {
    throw new HttpError(403, "Human verification is required.");
  }
  let result;
  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: request.headers.get("CF-Connecting-IP") || "",
      }),
    });
    if (!response.ok) throw new Error("siteverify responded with " + response.status);
    result = await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Turnstile siteverify request failed:", error && error.name ? error.name : "UnknownError");
    throw new HttpError(403, "Human verification could not be completed. Please try again.");
  }
  const verifiedHostname = typeof result.hostname === "string" ? result.hostname.trim().toLowerCase() : "";
  const hostnameAllowed = hostnames.some((configured) => {
    const expected = configured.toLowerCase();
    if (expected.startsWith("*.")) {
      const suffix = expected.slice(1);
      return verifiedHostname.length > suffix.length && verifiedHostname.endsWith(suffix);
    }
    return verifiedHostname === expected;
  });
  if (!result.success || result.action !== expectedAction || !hostnameAllowed) {
    throw new HttpError(403, "Human verification failed. Please try again.");
  }
}
