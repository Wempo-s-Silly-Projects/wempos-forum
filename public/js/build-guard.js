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
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// A tab's module map belongs to the build that loaded its HTML. Before a
// lazy route import, make sure the server has not moved to another build.
export async function reloadIfStaleBuild({ api, servedBuild, reload }) {
  if (!servedBuild || typeof api !== "function" || typeof reload !== "function") return false;

  let info;
  try {
    info = await api("/api/version");
  } catch {
    // A transient version-probe failure must not strand an otherwise usable
    // route; the existing session/setup reads still report their own errors.
    return false;
  }

  const version = typeof info?.version === "string" ? info.version : "";
  const commit = typeof info?.commit === "string" ? info.commit : "";
  const liveBuild = [version, commit].filter(Boolean).join("@");
  if (!liveBuild || liveBuild === servedBuild) return false;

  reload();
  return true;
}
