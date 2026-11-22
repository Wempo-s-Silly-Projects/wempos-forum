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

// Batch F: the client half of the self-hosted proof-of-work human check
// (ALTCHA), self-hosted end to end. No third-party script, frame
// or cookie: the browser fetches a signed challenge from the forum and the
// vendored altcha-lib v1 solver finds the number with Web Crypto SHA-256.
// The work starts as soon as a gated form renders, so it is usually done
// before the member presses Post; each solution is spent once, so taking it
// immediately starts the next one.
//
// Self-hosting: the shell stamps <meta name="human-check" content="altcha">
// only when the instance has a key; without it nothing is fetched or sent.
import { api } from "./api.js";
import { t } from "./i18n.js";

// The vendored solver loads on first use, only on instances with a check.
const loadSolver = () => import("./vendor/altcha-lib/v1/index.js");

const slots = new Map();

export function humanCheckEnabled() {
  const meta = globalThis.document?.querySelector?.('meta[name="human-check"]');
  return meta?.content === "altcha";
}

// The base64 JSON payload the worker's verifySolution expects.
export async function solveHumanChallenge(challenge) {
  const { solveChallenge } = await loadSolver();
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
  if (!solution) throw new Error(t("security.humanCheckFailed"));
  return btoa(JSON.stringify({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    number: solution.number,
    salt: challenge.salt,
    signature: challenge.signature,
  }));
}

function startSolving(state) {
  state.pending = api("/api/altcha/challenge").then(solveHumanChallenge);
  // Settled here so an unawaited failure never surfaces as unhandled; the
  // submit path awaits the same promise and reports the error then.
  state.pending.catch(() => {});
}

// A quiet status line before the submit button; it carries no controls.
export function addHumanCheckSlot(form) {
  if (!humanCheckEnabled()) return;
  const slot = document.createElement("small");
  slot.className = "form-note human-check-slot";
  slot.dataset.verificationPending = "true";
  form.insertBefore(slot, form.querySelector('button[type="submit"]'));
  slots.set(form, { pending: null });
}

export async function renderHumanCheckSlots(root) {
  for (const slot of root.querySelectorAll(".human-check-slot[data-verification-pending]")) {
    delete slot.dataset.verificationPending;
    const state = slots.get(slot.closest("form"));
    if (state && !state.pending) startSolving(state);
  }
}

export function teardownHumanCheck() {
  slots.clear();
}

// Resolves to the payload for this submission ("" when the instance runs
// without a check) and immediately starts solving the next one.
export async function takeHumanCheckPayload(form) {
  if (!humanCheckEnabled()) return "";
  const state = slots.get(form);
  if (!state) throw new Error(t("security.humanCheckIncomplete"));
  if (!state.pending) startSolving(state);
  const pending = state.pending;
  startSolving(state);
  try {
    return await pending;
  } catch {
    throw new Error(t("security.humanCheckFailed"));
  }
}
