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

// Self-hosting (v5.17.0): the instance's public origins come from config, so
// one codebase serves the owner's forum and anyone else's copy.
//   SITE_ORIGIN      the canonical public origin (e.g. https://wempos-forum.com).
//                    Unset: every document names the request's own origin and
//                    *.workers.dev is NOT redirected anywhere.
//   ACCOUNTS_ORIGIN  the Wempo Accounts origin every sign-in link targets.
//   RELAY_WORKER_NAME  this worker's slug on the Accounts redeem call.
// Only a well-formed http(s) origin counts; anything else reads as unset.

const DEFAULT_RELAY_WORKER_NAME = "wempos-forum";
const WORKER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

// configuredOrigin(value) -> "https://host[:port]" or "" when not a usable origin.
export function configuredOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
  } catch {
    return "";
  }
}

// siteOrigin(env, request) -> the configured SITE_ORIGIN, else the request's origin.
export function siteOrigin(env, request) {
  return configuredOrigin(env && env.SITE_ORIGIN) || new URL(request.url).origin;
}

// accountsOrigin(env) -> the configured ACCOUNTS_ORIGIN, or "" when unset.
export function accountsOrigin(env) {
  return configuredOrigin(env && env.ACCOUNTS_ORIGIN);
}

// relayWorkerName(env) -> the slug Accounts binds a ticket to (owner default).
export function relayWorkerName(env) {
  const name = env && typeof env.RELAY_WORKER_NAME === "string" ? env.RELAY_WORKER_NAME.trim() : "";
  return WORKER_NAME_PATTERN.test(name) ? name : DEFAULT_RELAY_WORKER_NAME;
}
