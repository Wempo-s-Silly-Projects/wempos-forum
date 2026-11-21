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

// v4.0 plan 4 Task 2: the boot state app.js's monolith used to hold in its
// closure scope, as a mutable property bag. Route modules need the same live
// values the monolith shared freely (who is signed in, which route is active,
// the monotonically increasing render version, the router, and renderRoute
// itself so submit handlers can re-render the active route) — a `let` cannot
// be re-exported, so the values ride as properties. app.js writes through the
// same bag; state.js is a leaf module, so no import cycle appears.
export const state = {
  router: null,
  currentUser: null,
  activeRoute: { name: "home" },
  renderVersion: 0,
  renderRoute: null,
  // Wave 5.3: the signed-in member's unread notification count from the
  // last session read (0 for guests), for the opt-in tab-title count.
  unreadNotifications: 0,
};
