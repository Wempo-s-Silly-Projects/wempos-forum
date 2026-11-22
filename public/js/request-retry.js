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

// Batch K: retry with backoff and a concurrency limiter for the api()
// wrapper, in the spirit of p-retry and p-limit. Those packages import bare
// names (is-network-error, yocto-queue) that a page without a bundler can
// only resolve through an inline import map, which the CSP forbids — so the
// small part the forum needs lives here. Constants mirror constants.mjs.

export const API_RETRY_ATTEMPTS = 2;
export const API_RETRY_BASE_DELAY_MS = 300;
export const API_RETRY_FACTOR = 3;
export const API_BATCH_CONCURRENCY = 4;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Reads are always safe to repeat. A write is retried only when the caller
// says it is idempotent: an Idempotency-Key the server dedupes on, or an
// explicit `idempotent: true`. A plain POST is never repeated blindly.
export function isRetryableMethod(method, { idempotent = false, idempotencyKey } = {}) {
  if (SAFE_METHODS.has(String(method).toUpperCase())) return true;
  if (idempotent === true) return true;
  return typeof idempotencyKey === "string" && idempotencyKey !== "";
}

export const backoffDelay = (attempt) => API_RETRY_BASE_DELAY_MS * API_RETRY_FACTOR ** attempt;

// Runs `attempt(index)` until it succeeds, `shouldRetry(error)` says no, or
// the budget is spent; waits backoffDelay(index) between tries.
export async function withRetry(attempt, { attempts = API_RETRY_ATTEMPTS, shouldRetry, sleep, signal } = {}) {
  for (let index = 0; ; index += 1) {
    try {
      return await attempt(index);
    } catch (error) {
      if (index >= attempts || signal?.aborted || !shouldRetry(error)) throw error;
      await sleep(backoffDelay(index));
    }
  }
}

// limit(fn) runs fn when fewer than `concurrency` limited jobs are running,
// and resolves or rejects with its result. Order of results is the caller's.
export function createLimit(concurrency = API_BATCH_CONCURRENCY) {
  const size = Number.isSafeInteger(concurrency) && concurrency > 0 ? concurrency : 1;
  const waiting = [];
  let active = 0;
  const next = () => {
    if (active >= size || waiting.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    next();
  });
}
