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

// Skip to content (v5.40.0 F2): the first focusable element on every page
// (index.html) jumps keyboard focus to the one <main>. A plain #main-content
// fragment would change the URL, fire popstate and make the router re-render
// the page under the reader, so the click is handled here: no navigation,
// focus moves to <main> (tabindex -1 keeps it focusable without adding a tab
// stop). Page-view only: no storage, no network.
export function wireSkipLink(doc) {
  const link = doc.querySelector("a.skip-link");
  const target = doc.querySelector("main");
  if (!link || !target) return false;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  });
  return true;
}
