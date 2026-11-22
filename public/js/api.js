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

import { t } from "./i18n.js";
import { API_RETRY_ATTEMPTS, createLimit, isRetryableMethod, withRetry } from "./request-retry.js";
let csrfToken = "";

export const setCsrfToken = (token) => {
  csrfToken = typeof token === "string" ? token : "";
};

// Error copy (wave 2026-11-21-3): a stable snake_case `code` from the server
// paints the member's own language via errors.<camelCaseCode> (locale keys
// are camelCase); unknown codes fall back to the server's English text, and
// an empty body to the generic status line.
export const errorKeyFor = (code) =>
  `errors.${code.replace(/_([a-z0-9])/g, (whole, next) => next.toUpperCase())}`;

export function errorMessageFor(result, status, translate = t) {
  const code = typeof result?.code === "string" ? result.code : "";
  if (/^[a-z][a-z0-9_]*$/.test(code)) {
    const key = errorKeyFor(code);
    const translated = translate(key);
    if (translated && translated !== key) return translated;
  }
  if (typeof result?.error === "string" && result.error) return result.error;
  return translate("api.requestFailed", { status });
}

// Batch K: idempotent requests (GET/HEAD/OPTIONS, or a write carrying an
// Idempotency-Key or `idempotent: true`) are retried with backoff on a
// network error or a 5xx; a plain POST is sent exactly once. `retry: false`
// opts out; an aborted request is never retried. The last 5xx answer falls
// through to the normal error handling below.
let retrySleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const setRetrySleep = (sleep) => {
  const previous = retrySleep;
  retrySleep = sleep;
  return previous;
};

const isAbort = (error) => error?.name === "AbortError";

async function sendOnce(path, { method, body, idempotencyKey, signal }) {
  const headers = { Accept: "application/json" };
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (mutating && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (mutating && typeof idempotencyKey === "string" && idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    signal,
    body: body === undefined ? undefined :
      body instanceof FormData ? body : JSON.stringify(body),
  });
}

async function fetchWithRetry(path, options) {
  const canRetry = options.retry !== false && isRetryableMethod(options.method, options);
  const attempts = canRetry ? API_RETRY_ATTEMPTS : 0;
  return withRetry(async (index) => {
    let response;
    try {
      response = await sendOnce(path, options);
    } catch (error) {
      if (!isAbort(error)) error.retryable = true;
      throw error;
    }
    if (response.status >= 500 && index < attempts) {
      throw Object.assign(new Error(String(response.status)), { retryable: true });
    }
    return response;
  }, {
    attempts,
    shouldRetry: (error) => error?.retryable === true && !isAbort(error),
    sleep: (ms) => retrySleep(ms),
    signal: options.signal,
  });
}

export const api = async (path, {
  method = "GET", body, idempotencyKey, idempotent = false, signal, as, retry,
} = {}) => {
  const response = await fetchWithRetry(path, { method, body, idempotencyKey, idempotent, signal, retry });
  if (as === "blob" && response.ok) return response.blob();
  if (response.status === 204) return null;
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(
      response.ok
        ? t("api.invalidResponse", { status: response.status })
        : t("api.requestFailed", { status: response.status }),
    );
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(errorMessageFor(result, response.status));
    error.status = response.status;
    // Copy the JSON body's extra fields onto the error (banned/reason/expiresAt
    // for the login ban screen, but additive for every response). "error" is
    // already the message, "message" would overwrite Error.message, and
    // "status" stays the HTTP status — all three are skipped.
    if (result && typeof result === "object") {
      for (const [key, value] of Object.entries(result)) {
        if (key !== "error" && key !== "message" && key !== "status") error[key] = value;
      }
    }
    throw error;
  }
  return result;
};

// Batched reads through one shared limiter (API_BATCH_CONCURRENCY at once):
// `requests` is a list of [path, options] pairs; the answer is the
// Promise.allSettled list in the same order.
const batchLimit = createLimit();
export const apiBatch = (requests) =>
  Promise.allSettled(requests.map(([path, options]) => batchLimit(() => api(path, options))));
