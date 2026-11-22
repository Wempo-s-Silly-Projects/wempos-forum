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

// No-module notice (v5.73, wave B3). index.html loads this file with
// `nomodule`, so only browsers that cannot run the forum's ES modules execute
// it; they would otherwise see a blank page. It un-hides the static
// #legacy-notice block and does nothing else. Plain ES5 on purpose: no
// arrow functions, no let/const, no modules.
(function () {
  var notice = document.getElementById("legacy-notice");
  if (notice) notice.removeAttribute("hidden");
})();
