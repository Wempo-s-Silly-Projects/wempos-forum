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

// Embeds (v5.76): the lazy, same-origin loader for the vendored players.
// Every path is a file under /js/vendor/ (script-src 'self'); each module is
// imported at most once per page and a failure is not retried (the embed
// keeps its native fallback). Stylesheets are <link> tags (style-src 'self').
const imports = new Map();

export function createVendorLoader(document) {
  return {
    import(path) {
      if (!imports.has(path)) imports.set(path, import(path));
      return imports.get(path);
    },
    stylesheet(href) {
      const head = document?.head;
      if (!head || typeof head.append !== "function") return;
      const present = Array.from(head.children ?? []).some((node) => node.dataset?.embedStylesheet === href);
      if (present) return;
      const link = document.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("href", href);
      link.dataset.embedStylesheet = href;
      head.append(link);
    },
  };
}
