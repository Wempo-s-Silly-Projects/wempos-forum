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

// Polyfill gate (slate 2026-11-22-e, E1). index.html runs this as a blocking
// classic script ahead of every module. It checks the built-ins that the
// self-hosted core-js build (public/js/vendor/core-js.js, rebuilt by
// scripts/build-core-js.mjs) fills, and only when one is missing does it add
// the build's same-origin <script>. It runs from <head> before the parser
// reaches the module tags, so the fetch starts ahead of the module graph and
// async = false keeps it in insertion order. No HTML is written (the client
// never uses document.write). Current browsers download nothing extra.
// Plain ES5 on purpose: it must parse on browsers older than the floor.
(function () {
  var needsPolyfill =
    typeof Array.prototype.at !== "function" ||
    typeof Object.hasOwn !== "function";
  if (!needsPolyfill) return;
  var script = document.createElement("script");
  script.src = "/js/vendor/core-js.js";
  script.async = false;
  document.head.appendChild(script);
})();
