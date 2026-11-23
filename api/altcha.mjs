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

// Batch F: GET /api/altcha/challenge hands the browser a fresh signed
// proof-of-work challenge (api/core/human-check.mjs). Instances without a
// key answer 404 — the shell's missing "human-check" meta already told the
// client not to ask. Issuing is one HMAC; the read limiter bounds it.
import { createHumanChallenge } from "./core/human-check.mjs";
import { HttpError, json, rateLimit } from "./core/http.mjs";

export async function handleAltchaRoutes(request, env, url, path, method) {
  if (path !== "/api/altcha/challenge" || method !== "GET") return null;
  await rateLimit(request, env, "read");
  const challenge = await createHumanChallenge(env);
  if (!challenge) throw new HttpError(404, "Not found.");
  return json(challenge);
}
