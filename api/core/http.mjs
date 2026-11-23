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

// v4.0 core leaf: request/response glue — the typed error, JSON responses,
// the security-header set, rate limiting, bounded
// body reading, and field validation.
//
// Phase-1 Kitskey migration: the error/response/rate-limit vocabulary now
// LIVES in api/vendor/http.mjs (byte-identical to the framework's
// experience/http.mjs — pinned by tests/vendor-parity.test.mjs; the file is
// the framework's, not an app-owned copy). This leaf re-exports that surface
// unchanged so every api module imports exactly the way it did — public
// signatures and messages never moved — and keeps the app-side pieces: the
// App CSP adjustments and the forum's limiter binding map (the human check
// lives in human-check.mjs since Batch F).
import { parse as parseMediaType } from "content-type";
import secureJson from "secure-json-parse";
import { RATE_LIMIT_BINDINGS, WAVESURFER_STYLE_HASH, YOUTUBE_EMBED_ORIGIN } from "../../constants.mjs";
import {
  HttpError,
  MAX_JSON_BYTES,
  errorReply,
  json as vendorJson,
  makeHttp,
  securityHeaders as vendorSecurityHeaders,
} from "../vendor/http.mjs";

// The vendored surface, unchanged; since phase 2, worker.mjs consumes errorReply
// and dispatch from here (the vendor import is theirs — one classifier, one
// dispatch chain, no twin); since phase 4 also the static leg (secureResponse
// above, unconditional re-exported from the vendor).
export { HttpError, MAX_JSON_BYTES, errorReply };
// Batch F: Turnstile is retired, so its origin leaves the policy. The vendor
// file stays untouched (never-touch law); the app strips the origin from the
// vendor CSP and drops the frame-src it leaves empty. Every app-built
// response (JSON through json(), documents through the static leg) carries
// the stripped policy.
const RETIRED_CSP_ORIGIN = " https://challenges.cloudflare.com";

function withoutRetiredOrigin(csp) {
  return csp
    .split(RETIRED_CSP_ORIGIN).join("")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && part !== "frame-src")
    .join("; ");
}

export function securityHeaders(headers = new Headers()) {
  const result = vendorSecurityHeaders(headers);
  const csp = result.get("Content-Security-Policy");
  if (csp) result.set("Content-Security-Policy", withoutRetiredOrigin(csp));
  return result;
}

export function json(data, status = 200, headers = {}) {
  const response = vendorJson(data, status, headers);
  const csp = response.headers.get("Content-Security-Policy");
  if (csp) response.headers.set("Content-Security-Policy", withoutRetiredOrigin(csp));
  return response;
}

// v5.71.2 (owner Nov 22 13:35, "Override CSP"): the HTML shell loads the
// cdnjs polyfill service as a classic script before the module graph, for
// visitors on browsers that can't or won't update. The vendored framework
// file stays untouched; the static leg binds this app-owned header set via
// makeHttp's securityHeaders hook (the framework's own extension point for a
// divergent app). Only static-leg (ASSETS) responses carry it; JSON,
// feeds, images and discovery keep the vendor set.
// v5.73.1 (security review M1): scoped to the polyfill path, not the whole
// CDN — cdnjs also hosts libraries that are known CSP-bypass gadgets.
const POLYFILL_ORIGIN = "https://cdnjs.cloudflare.com/polyfill/";
const VENDOR_SCRIPT_SRC = "script-src 'self';";
// Splices run on the policy AFTER securityHeaders has retired Turnstile (its
// origin is gone and the then-empty frame-src dropped). Each names the exact
// directive it widens. v5.76 embeds: frame-src admits youtube-nocookie only
// (the iframe exists only after the reader presses play); img-src gains no
// thumbnail host; blob: covers hls.js MediaSource and <model-viewer> textures;
// the style hash admits exactly WaveSurfer's static shadow <style>.
const DOCUMENT_CSP_SPLICES = [
  [VENDOR_SCRIPT_SRC, "script-src 'self' " + POLYFILL_ORIGIN + ";"],
  ["style-src 'self';", "style-src 'self' '" + WAVESURFER_STYLE_HASH + "';"],
  ["img-src 'self' data:;", "img-src 'self' data: blob:; media-src 'self' blob:;"],
  ["connect-src 'self';", "connect-src 'self' blob:;"],
  ["object-src 'none';", "frame-src " + YOUTUBE_EMBED_ORIGIN + "; object-src 'none';"],
];

export function forumDocumentSecurityHeaders(headers = new Headers()) {
  const result = securityHeaders(headers);
  const csp = result.get("Content-Security-Policy") ?? "";
  // Fail closed: if the vendor policy ever changes shape, keep it as-is
  // rather than splicing an origin into an unknown directive.
  if (!DOCUMENT_CSP_SPLICES.every(([from]) => csp.includes(from))) return result;
  result.set(
    "Content-Security-Policy",
    DOCUMENT_CSP_SPLICES.reduce((policy, [from, to]) => policy.replace(from, to), csp),
  );
  return result;
}

// The config-bound half: the forum's limiter map, the shared JSON cap, and
// (since v5.71.2) the document header set above for the static leg.
const app = makeHttp({
  rateLimitBindings: RATE_LIMIT_BINDINGS,
  maxJsonBytes: MAX_JSON_BYTES,
  securityHeaders: forumDocumentSecurityHeaders,
});
export const rateLimit = app.rateLimit;
export const requireMutationApplied = app.requireMutationApplied;
export const readLimitedBody = app.readLimitedBody;

// ---- Content-Type (RFC 9110 media type) ----------------------------------

const MEDIA_TYPE_PATTERN = /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/;
const JSON_MEDIA_TYPE = "application/json";
const UTF8_CHARSETS = new Set(["", "utf-8", "utf8"]);

// parseContentType(header) -> { type, charset } (both lowercase; charset ""
// when absent), or null for a missing or malformed header. One parser for
// every route that branches on the body's media type.
export function parseContentType(header) {
  if (typeof header !== "string" || !header.trim()) return null;
  let parsed;
  try {
    parsed = parseMediaType(header);
  } catch {
    return null;
  }
  const type = String(parsed.type || "").toLowerCase();
  if (!MEDIA_TYPE_PATTERN.test(type)) return null;
  const charset = typeof parsed.parameters?.charset === "string" ? parsed.parameters.charset.toLowerCase() : "";
  return { type, charset };
}

export function requestContentType(request) {
  return parseContentType(request.headers.get("Content-Type"));
}

export function isMultipartRequest(request) {
  return requestContentType(request)?.type === "multipart/form-data";
}

// ---- JSON bodies ----------------------------------------------------------

const SAFE_JSON_OPTIONS = Object.freeze({ protoAction: "error", constructorAction: "error" });

// parseJsonSafely(text) -> the parsed value; throws SyntaxError on invalid
// JSON or on a "__proto__" key / "constructor.prototype" pair at any depth
// (secure-json-parse semantics), so request data can never reach an object
// prototype however a route later copies it.
export function parseJsonSafely(text) {
  return secureJson.parse(text, null, SAFE_JSON_OPTIONS);
}

// readJson(request) -> the JSON object body. Same contract and copy as the
// vendor helper it replaces, plus: the media type must be exactly
// application/json with a UTF-8 (or absent) charset — look-alikes such as
// application/jsonp answer 415 — and the parse refuses prototype keys.
export async function readJson(request, bytesOverride = MAX_JSON_BYTES) {
  const contentType = requestContentType(request);
  if (!contentType || contentType.type !== JSON_MEDIA_TYPE || !UTF8_CHARSETS.has(contentType.charset)) {
    throw new HttpError(415, "Send this form as JSON.");
  }
  const bytes = await readLimitedBody(request, bytesOverride);
  let value;
  try {
    value = parseJsonSafely(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
  return value;
}
export const requiredText = app.requiredText;
export const secureResponse = app.secureResponse;

// Phase-4: the conditional-get force-200 trade (documents only) is the
// framework verbatim — re-exported so worker.mjs's static branch keeps its
// exact call shape.
export { unconditional, isDocumentRequest } from "../vendor/http.mjs";
