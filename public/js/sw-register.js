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

// Batch K: registers /sw.js versioned by the deploy's build stamp (the
// app-build meta the worker writes into every page), so a new deploy means
// a new worker URL, a fresh install and the old static cache dropped. No
// stamp (local dev, an unstamped deploy) means no worker at all. A browser
// that refuses (private window, disabled) just keeps working without it.

export const SW_PATH = "/sw.js";

export const serviceWorkerUrl = (build) => `${SW_PATH}?build=${encodeURIComponent(build)}`;

export async function registerServiceWorker({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  const build = doc?.querySelector?.('meta[name="app-build"]')?.content || "";
  if (!build || typeof nav?.serviceWorker?.register !== "function") return null;
  try {
    return await nav.serviceWorker.register(serviceWorkerUrl(build), { scope: "/" });
  } catch {
    return null;
  }
}
